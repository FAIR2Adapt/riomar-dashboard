import * as zarr from "zarrita";

import { ZarrDataManager } from "./ZarrDataManager";
import { createMissingOrFillPredicate } from "./zarrUtils";

import type { TDerivedVariable, TSources } from "@/lib/types/GlobeTypes";

/** A zarr selection: one entry per array axis (index, slice, or null = full). */
export type TSelectionArr = (number | null | zarr.Slice)[];

/**
 * A stand-in for a `zarr.Array` that represents a derived (formula) variable.
 * It exposes just the surface the consumers read (`shape`, `attrs`, `dtype`)
 * plus a `__derived` marker so {@link ZarrDataManager.getVariableDataFromArray}
 * can route it to {@link evaluateDerived} instead of `zarr.get`.
 */
export type TSyntheticArray = {
  __derived: TDerivedVariable;
  shape: number[];
  dtype: "float32";
  attrs: zarr.Attributes;
};

/** A `zarr.Chunk`-shaped result of evaluating a derived variable. */
export type TDerivedChunk = {
  data: Float32Array;
  shape: number[];
  stride: number[];
};

/** Math names exposed (unprefixed) inside formula expressions. */
const MATH_KEYS = [
  "abs", "sqrt", "cbrt", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "exp", "expm1", "log", "log2", "log10", "log1p",
  "pow", "min", "max", "floor", "ceil", "round", "trunc", "sign", "hypot",
  "PI", "E",
];

/** Whether `name` is usable as a bare identifier inside a JS expression. */
export function isValidIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !MATH_KEYS.includes(name);
}

/**
 * Compiles a formula into a function taking one positional argument per input
 * variable (in `inputs` order). `Math` functions/constants are available
 * unprefixed (e.g. `sqrt`, `PI`). The expression is user-supplied JS — acceptable
 * here because it only runs against the user's own local input.
 */
export function compileExpression(
  expression: string,
  inputs: string[]
): (...vals: number[]) => number {
  for (const name of inputs) {
    if (!isValidIdentifier(name)) {
      throw new Error(
        `Variable name "${name}" cannot be used in a formula (not a valid identifier).`
      );
    }
  }
  const header = `const {${MATH_KEYS.join(",")}} = Math;`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function(
    ...inputs,
    `"use strict";${header} return (${expression});`
  ) as (...vals: number[]) => number;
  return fn;
}

/** True if `sub` appears within `sup` in the same relative order (a subsequence). */
function isOrderedSubset(sub: string[], sup: string[]): boolean {
  let j = 0;
  for (const name of sub) {
    while (j < sup.length && sup[j] !== name) {
      j += 1;
    }
    if (j >= sup.length) {
      return false;
    }
    j += 1;
  }
  return true;
}

/**
 * Resolves the broadcast dimensions of a formula from its operands' dimension
 * lists. The reference operand is the one with the most dimensions; every other
 * operand's dimensions must be an ordered subset of it (so it can be broadcast
 * along the missing axes). Throws a descriptive error when operands cannot be
 * aligned (disjoint dimensions / different grids).
 */
export function computeResultDims(operandDims: Record<string, string[]>): {
  resultDims: string[];
  referenceVar: string;
} {
  const names = Object.keys(operandDims);
  if (names.length === 0) {
    throw new Error("A formula needs at least one input variable.");
  }
  let referenceVar = names[0];
  for (const name of names) {
    if (operandDims[name].length > operandDims[referenceVar].length) {
      referenceVar = name;
    }
  }
  const resultDims = operandDims[referenceVar];
  for (const name of names) {
    if (!isOrderedSubset(operandDims[name], resultDims)) {
      throw new Error(
        `"${name}" has dimensions [${operandDims[name].join(", ")}] which are ` +
          `not compatible with [${resultDims.join(", ")}]. Inputs must share a ` +
          `nested set of dimensions (one a subset of another).`
      );
    }
  }
  return { resultDims, referenceVar };
}

/** A selection entry is "kept" (becomes an output axis) when it is a slice or null. */
function isKeptAxis(s: number | null | zarr.Slice): boolean {
  return s === null || typeof s === "object";
}

/** Row-major (C-contiguous) strides for a shape. */
function contiguousStride(shape: number[]): number[] {
  const stride = new Array<number>(shape.length);
  let acc = 1;
  for (let i = shape.length - 1; i >= 0; i -= 1) {
    stride[i] = acc;
    acc *= shape[i];
  }
  return stride;
}

/** Builds the synthetic-array attributes for a derived variable. */
function buildAttrs(
  def: TDerivedVariable,
  refAttrs: zarr.Attributes
): zarr.Attributes {
  const attrs: zarr.Attributes = {};
  // Copy only what grid/CRS detection needs from the reference operand; do NOT
  // copy fill/missing values (operands already map missing data to NaN).
  if (refAttrs.grid_mapping) {
    attrs.grid_mapping = refAttrs.grid_mapping;
  }
  if (refAttrs.coordinates) {
    attrs.coordinates = refAttrs.coordinates;
  }
  attrs.units = def.units ?? "";
  attrs.long_name = def.longName ?? def.name;
  attrs.standard_name = def.longName ?? def.name;
  attrs._ARRAY_DIMENSIONS = def.resultDims;
  attrs.dimensionNames = def.resultDims;
  return attrs;
}

/**
 * Builds the synthetic array exposed for a derived variable. Its shape and
 * grid-related attributes come from the reference operand's real array.
 */
export async function buildSyntheticArray(
  def: TDerivedVariable,
  datasources: TSources
): Promise<TSyntheticArray> {
  const refSource = ZarrDataManager.getDatasetSource(datasources, def.referenceVar);
  const refArr = await ZarrDataManager.getVariableInfo(refSource, def.referenceVar);
  return {
    __derived: def,
    shape: Array.from(refArr.shape),
    dtype: "float32",
    attrs: buildAttrs(def, refArr.attrs),
  };
}

type TOperand = {
  data: ArrayLike<number | bigint>;
  /** Strides of the fetched chunk (one per kept operand axis). */
  stride: readonly number[];
  /** For each kept chunk axis, the corresponding output-axis index. */
  axisToOut: number[];
  isMissing: (v: number) => boolean;
};

/** Loads one operand's chunk and computes its chunk-axis → output-axis mapping. */
async function loadOperand(
  name: string,
  datasources: TSources,
  resultDims: string[],
  sel: TSelectionArr,
  keptResultDims: string[]
): Promise<TOperand> {
  const src = ZarrDataManager.getDatasetSource(datasources, name);
  const arr = await ZarrDataManager.getVariableInfo(src, name);
  const opDims = await ZarrDataManager.getDimensionNames(datasources, name);
  const opSel: TSelectionArr = opDims.map((d) => {
    const idx = resultDims.indexOf(d);
    return idx === -1 ? 0 : sel[idx];
  });
  const chunk = await ZarrDataManager.getVariableDataFromArray(arr, opSel);
  const keptOpDims: string[] = [];
  for (let i = 0; i < opDims.length; i += 1) {
    if (isKeptAxis(opSel[i])) {
      keptOpDims.push(opDims[i]);
    }
  }
  const axisToOut = keptOpDims.map((d) => keptResultDims.indexOf(d));
  return {
    data: chunk.data as ArrayLike<number | bigint>,
    stride: chunk.stride,
    axisToOut,
    isMissing: createMissingOrFillPredicate(arr),
  };
}

/**
 * Evaluates a derived variable for the given selection (over its result
 * dimensions), fetching each operand, broadcasting operands that lack some
 * result dimensions, and applying the compiled expression element-wise. Any
 * element where an operand is missing/fill/NaN becomes NaN.
 */
export async function evaluateDerived(
  def: TDerivedVariable,
  datasources: TSources,
  selection: TSelectionArr
): Promise<TDerivedChunk> {
  const resultDims = def.resultDims;
  const sel: TSelectionArr =
    selection && selection.length > 0 ? selection.slice() : resultDims.map(() => null);

  // The reference operand carries all result dimensions and drives output shape.
  const refSource = ZarrDataManager.getDatasetSource(datasources, def.referenceVar);
  const refArr = await ZarrDataManager.getVariableInfo(refSource, def.referenceVar);
  const refChunk = await ZarrDataManager.getVariableDataFromArray(refArr, sel);
  const outShape = Array.from(refChunk.shape as readonly number[]);
  const outStride = contiguousStride(outShape);
  const total = outShape.reduce((a, b) => a * b, 1);

  const keptResultDims: string[] = [];
  for (let i = 0; i < resultDims.length; i += 1) {
    if (isKeptAxis(sel[i])) {
      keptResultDims.push(resultDims[i]);
    }
  }
  const operands = await Promise.all(
    def.inputs.map((name) =>
      loadOperand(name, datasources, resultDims, sel, keptResultDims)
    )
  );

  const compiled = compileExpression(def.expression, def.inputs);
  const out = new Float32Array(total);
  const ndim = outShape.length;
  const idx = new Array<number>(ndim).fill(0);
  const vals = new Array<number>(def.inputs.length);

  for (let flat = 0; flat < total; flat += 1) {
    let missing = false;
    for (let o = 0; o < operands.length; o += 1) {
      const op = operands[o];
      let offset = 0;
      for (let a = 0; a < op.stride.length; a += 1) {
        offset += idx[op.axisToOut[a]] * op.stride[a];
      }
      const v = Number(op.data[offset]);
      if (op.isMissing(v)) {
        missing = true;
        break;
      }
      vals[o] = v;
    }
    out[flat] = missing ? NaN : compiled(...vals);
    // Advance the odometer (last axis fastest).
    for (let a = ndim - 1; a >= 0; a -= 1) {
      idx[a] += 1;
      if (idx[a] < outShape[a]) {
        break;
      }
      idx[a] = 0;
    }
  }

  return { data: out, shape: outShape, stride: outStride };
}
