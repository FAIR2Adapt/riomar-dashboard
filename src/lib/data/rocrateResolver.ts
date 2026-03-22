/**
 * Resolve an RO-Crate PID to a Zarr dataset URL via the ROHub API.
 * Also extracts structured metadata (I-ADOPT variables, claims, coverage)
 * for display in the dashboard.
 */

const RO_ID_PREFIX = "https://w3id.org/ro-id/";
const ROHUB_API = "https://api.rohub.org/api/";

// schema.org vocabulary
const POTENTIAL_ACTION = "https://schema.org/potentialAction";
const VIEW_ACTION = "https://schema.org/ViewAction";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
// const URL_TEMPLATE = "https://schema.org/urlTemplate";
const SCHEMA_OBJECT = "https://schema.org/object";
const SCHEMA_NAME = "https://schema.org/name";
const SCHEMA_TEXT = "https://schema.org/text";
const SCHEMA_VARIABLE = "https://schema.org/variableMeasured";
const SCHEMA_CLAIM = "https://schema.org/Claim";
const SCHEMA_HAS_CLAIM = "https://schema.org/hasClaim";
const IADOPT_PROPERTY = "https://w3id.org/iadopt/ont/hasProperty";
const IADOPT_OOI = "https://w3id.org/iadopt/ont/hasObjectOfInterest";
const IADOPT_MATRIX = "https://w3id.org/iadopt/ont/hasMatrix";
const SCHEMA_URL = "https://schema.org/url";
const SCHEMA_TEMPORAL = "https://schema.org/temporalCoverage";
const SCHEMA_SPATIAL = "https://schema.org/spatialCoverage";
const SCHEMA_LICENSE = "https://schema.org/license";
const SCHEMA_IDENTIFIER = "https://schema.org/identifier";
const DCTERMS_REFERENCED = "http://purl.org/dc/terms/isReferencedBy";
const SPATIAL_RESOLUTION = "http://data.europa.eu/930/spatialResolutionAsText";

interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

interface Annotation {
  identifier: string;
}

interface Resource {
  identifier: string;
  type: string;
  name: string;
  url: string;
}

export interface IADOPTVariable {
  name: string;
  property?: string;
  propertyURI?: string;
  objectOfInterest?: string;
  objectOfInterestURI?: string;
  matrix?: string;
}

export interface AIDAClaim {
  text: string;
  nanopubURI?: string;
}

export interface ROCrateMetadata {
  pid: string;
  title: string;
  description: string;
  datasetUrl: string | null;
  variables: IADOPTVariable[];
  claims: AIDAClaim[];
  temporalCoverage?: string;
  spatialCoverage?: string;
  spatialResolution?: string;
  license?: string;
  identifier?: string;
  nanopubResources: Resource[];
}

/**
 * Check if a URL is an RO-Crate PID.
 */
export function isROCratePID(url: string): boolean {
  return url.startsWith(RO_ID_PREFIX);
}

/**
 * Extract the RO identifier from a PID URL.
 */
function extractROId(pid: string): string {
  return pid.replace(RO_ID_PREFIX, "").replace(/\/$/, "");
}

/**
 * Fetch all pages from a paginated API endpoint.
 */
async function fetchAllPages<T>(url: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const resp: Response = await fetch(nextUrl);
    if (!resp.ok) {
      return results;
    }
    const data = await resp.json();
    const items = data.results ?? (Array.isArray(data) ? data : []);
    results.push(...items);
    nextUrl = data.next ?? null;
  }
  return results;
}

/**
 * Helper: find object value for a given subject + predicate.
 */
function getObject(
  triples: Triple[],
  subject: string,
  predicate: string
): string | undefined {
  return triples.find((t) => t.subject === subject && t.predicate === predicate)
    ?.object;
}

/**
 * Resolve an RO-Crate PID to a dataset URL and structured metadata.
 */
// eslint-disable-next-line max-lines-per-function
export async function resolveROCrateWithMetadata(
  pid: string
): Promise<ROCrateMetadata> {
  const roId = extractROId(pid);
  console.log(`[RO-Crate] Resolving ${pid} (id: ${roId})`);

  const metadata: ROCrateMetadata = {
    pid,
    title: "",
    description: "",
    datasetUrl: null,
    variables: [],
    claims: [],
    nanopubResources: [],
  };

  // Fetch RO basic info
  try {
    const roResp = await fetch(`${ROHUB_API}ros/${roId}/`);
    if (roResp.ok) {
      const roData = await roResp.json();
      metadata.title = roData.title ?? "";
      metadata.description = roData.description ?? "";
    }
  } catch {
    // Continue without basic info
  }

  // Fetch annotations
  const annotations = await fetchAllPages<Annotation>(
    `${ROHUB_API}ros/${roId}/annotations/`
  );

  // Collect all triples
  const allTriples: Triple[] = [];
  for (const annot of annotations) {
    const triples = await fetchAllPages<Triple>(
      `${ROHUB_API}annotations/${annot.identifier}/body/`
    );
    allTriples.push(...triples);
  }
  console.log(`[RO-Crate] Found ${allTriples.length} triples`);

  // Fetch resources
  const resources = await fetchAllPages<Record<string, string>>(
    `${ROHUB_API}ros/${roId}/resources/`
  );
  const typedResources: Resource[] = resources.map((r) => ({
    identifier: r.identifier,
    type: r.type,
    name: r.name,
    url: r.url,
  }));

  // Find nanopub resources (Bibliographic Resources with sciencelive URLs)
  metadata.nanopubResources = typedResources.filter(
    (r) => r.type === "Bibliographic Resource" && r.url?.includes("sciencelive")
  );

  // --- Resolve dataset URL via ViewAction ---
  const actionTriple = allTriples.find((t) => t.predicate === POTENTIAL_ACTION);
  if (actionTriple) {
    const actionId = actionTriple.object;
    const typeTriple = allTriples.find(
      (t) => t.subject === actionId && t.predicate === RDF_TYPE
    );
    if (typeTriple?.object === VIEW_ACTION) {
      const objectTriple = allTriples.find(
        (t) => t.subject === actionId && t.predicate === SCHEMA_OBJECT
      );
      if (objectTriple) {
        const resourceId = objectTriple.object
          .replace(/\/$/, "")
          .split("/")
          .pop()!;
        const match = typedResources.find((r) => r.identifier === resourceId);
        if (match?.url) {
          metadata.datasetUrl = match.url;
        }
      }
    }
  }

  // Fallback: find Dataset resource
  if (!metadata.datasetUrl) {
    const dataset = typedResources.find((r) => r.type === "Dataset");
    if (dataset?.url) {
      metadata.datasetUrl = dataset.url;
    }
  }

  // --- Extract I-ADOPT variables ---
  const variableIds = new Set<string>();
  for (const t of allTriples) {
    if (t.predicate === SCHEMA_VARIABLE) {
      variableIds.add(t.object);
    }
  }

  for (const varId of variableIds) {
    const name = getObject(allTriples, varId, SCHEMA_NAME);
    if (!name) {
      continue;
    }

    const propId = getObject(allTriples, varId, IADOPT_PROPERTY);
    const ooiId = getObject(allTriples, varId, IADOPT_OOI);
    const matrixId = getObject(allTriples, varId, IADOPT_MATRIX);

    const variable: IADOPTVariable = { name };

    if (propId) {
      variable.property = getObject(allTriples, propId, SCHEMA_NAME);
      variable.propertyURI = getObject(allTriples, propId, SCHEMA_URL);
    }
    if (ooiId) {
      variable.objectOfInterest = getObject(allTriples, ooiId, SCHEMA_NAME);
      variable.objectOfInterestURI = getObject(allTriples, ooiId, SCHEMA_URL);
    }
    if (matrixId) {
      variable.matrix = getObject(allTriples, matrixId, SCHEMA_NAME);
    }

    metadata.variables.push(variable);
  }

  // --- Extract claims ---
  const claimIds = new Set<string>();
  for (const t of allTriples) {
    if (t.predicate === SCHEMA_HAS_CLAIM) {
      claimIds.add(t.object);
    }
  }
  // Also find claims by type
  for (const t of allTriples) {
    if (t.predicate === RDF_TYPE && t.object === SCHEMA_CLAIM) {
      claimIds.add(t.subject);
    }
  }

  for (const claimId of claimIds) {
    const text = getObject(allTriples, claimId, SCHEMA_TEXT);
    if (!text) {
      continue;
    }
    const nanopubURI = getObject(allTriples, claimId, DCTERMS_REFERENCED);
    metadata.claims.push({ text, nanopubURI });
  }

  // --- Extract coverage and metadata ---
  // Search across all subjects for these predicates
  for (const t of allTriples) {
    if (t.predicate === SCHEMA_TEMPORAL && !metadata.temporalCoverage) {
      metadata.temporalCoverage = t.object;
    }
    if (t.predicate === SPATIAL_RESOLUTION && !t.object.startsWith("http")) {
      metadata.spatialResolution = t.object;
    }
    if (t.predicate === SCHEMA_LICENSE && !metadata.license) {
      metadata.license = t.object;
    }
    if (t.predicate === SCHEMA_IDENTIFIER && !metadata.identifier) {
      metadata.identifier = t.object;
    }
  }

  // Spatial coverage: find Place entities linked via spatialCoverage
  for (const t of allTriples) {
    if (t.predicate === SCHEMA_SPATIAL) {
      // Check if the object is a Place entity with a name
      const placeName = getObject(allTriples, t.object, SCHEMA_NAME);
      if (placeName) {
        metadata.spatialCoverage = placeName;
        break;
      }
      // Or it might be a plain text value
      if (!t.object.startsWith("http")) {
        metadata.spatialCoverage = t.object;
        break;
      }
    }
  }

  console.log(
    `[RO-Crate] Metadata: ${metadata.variables.length} variables, ${metadata.claims.length} claims`
  );

  return metadata;
}

/**
 * Resolve an RO-Crate PID to just the dataset URL (backward compatible).
 */
export async function resolveROCrate(pid: string): Promise<string | null> {
  const metadata = await resolveROCrateWithMetadata(pid);
  return metadata.datasetUrl;
}
