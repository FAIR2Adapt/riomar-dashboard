import type { Dayjs } from "dayjs";
import * as zarr from "zarrita";

import type { TColorMap } from "@/lib/shaders/colormapShaders";

export const ZARR_FORMAT = {
  V2: 2,
  V3: 3,
} as const;

export type TZarrFormat = (typeof ZARR_FORMAT)[keyof typeof ZARR_FORMAT];

export type EmptyObj = Record<PropertyKey, never>;

export type TBounds = EmptyObj | { low: number; high: number };

export type TSelection = {
  bounds: TBounds;
};

export type TDimensionRange = {
  name: string;
  startPos: number;
  minBound: number;
  maxBound: number;
} | null;

export type TDimInfo =
  | EmptyObj
  | {
      current: Dayjs | number;
      values: Int32Array;
      units?: string;
      attrs: zarr.Attributes;
      longName?: string;
    };

export type TVarInfo = {
  dimInfo: TDimInfo[];
  bounds: TBounds;
  dimRanges: TDimensionRange[];
  attrs: zarr.Attributes;
};

/**
 * A user-defined variable computed from a JavaScript expression over existing
 * variables of the same dataset. `referenceVar` and `resultDims` are resolved
 * once when the formula is created (see {@link computeResultDims}); the result
 * shares the reference operand's grid, CRS and cell list.
 */
export type TDerivedVariable = {
  /** Unique name of the new variable. */
  name: string;
  /** JS expression referencing the `inputs` as bare identifiers. */
  expression: string;
  /** Operand variable names, all from the current dataset. */
  inputs: string[];
  /** Operand whose dimensions are a superset of the others (drives grid/shape). */
  referenceVar: string;
  /** Broadcast dimension-name list; the spatial axis is always last. */
  resultDims: string[];
  /** User-supplied units, optional. */
  units?: string;
  /** User-supplied long name, optional. */
  longName?: string;
};

export type TDataSource = {
  store: string;
  dataset: string;
  default_colormap?: {
    name: TColorMap;
    inverted: boolean;
  };
  hidden?: boolean;
  default_range?: TBounds;
  attrs?: zarr.Attributes;
  /** Present when this entry is a derived (formula) variable. */
  derived?: TDerivedVariable;
};

export type TModelInfo = {
  vars: Record<string, TDataSource>;
  defaultVar: string;
  title: string;
  colormaps: TColorMap[];
};

export type TMultiscalesLevel = {
  asset: string;
  [key: string]: unknown;
};

export type TMultiscalesInfo = {
  baseUrl: string;
  layout: TMultiscalesLevel[];
};

export type TSources = {
  name?: string;
  zarr_format: TZarrFormat;
  default_var?: string;
  multiscales?: TMultiscalesInfo;
  levels: {
    name?: string;
    grid: {
      store: string;
      dataset: string;
    };
    time: {
      store: string;
      dataset: string;
    };
    datasources: Record<string, TDataSource>;
  }[];
};

export type TZarrV3RootMetadata = {
  zarr_format: 3;
  node_type: "group";
  attributes?: Record<string, unknown>;
  consolidated_metadata: {
    metadata: Record<string, zarr.ArrayMetadata | zarr.GroupMetadata>;
  };
};
