/**
 * Resolve an RO-Crate PID to a Zarr dataset URL via the ROHub API.
 *
 * When the dashboard receives a URL like:
 *   #https://w3id.org/ro-id/fdc1c071-76d7-44df-a565-8217ebcc59fe
 *
 * This module:
 * 1. Detects it's an RO-Crate PID (not a direct Zarr URL)
 * 2. Queries ROHub annotations to find a schema:ViewAction with a schema:urlTemplate
 * 3. Resolves the dataset URL from the linked resource
 * 4. Returns the Zarr dataset URL for the dashboard to load
 */

const RO_ID_PREFIX = "https://w3id.org/ro-id/";
const ROHUB_API = "https://api.rohub.org/api/";

// schema.org vocabulary
const POTENTIAL_ACTION = "https://schema.org/potentialAction";
const VIEW_ACTION = "https://schema.org/ViewAction";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const URL_TEMPLATE = "https://schema.org/urlTemplate";
const SCHEMA_OBJECT = "https://schema.org/object";

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
  url: string;
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
 * Fetch all triples from a single annotation.
 */
async function fetchAnnotationTriples(annotationId: string): Promise<Triple[]> {
  const triples: Triple[] = [];
  let nextUrl: string | null = `${ROHUB_API}annotations/${annotationId}/body/`;

  while (nextUrl) {
    const resp: Response = await fetch(nextUrl);
    if (!resp.ok) {
      return triples;
    }
    const data: { results?: Triple[]; next?: string } = await resp.json();
    const results = data.results ?? [];
    for (const r of results) {
      triples.push({
        subject: r.subject,
        predicate: r.predicate,
        object: r.object,
      });
    }
    nextUrl = data.next ?? null;
  }
  return triples;
}

/**
 * Resolve an RO-Crate PID to a Zarr dataset URL.
 *
 * Discovery logic:
 * 1. List all annotations on the RO
 * 2. Collect all triples, looking for a ViewAction with a urlTemplate
 * 3. Follow schema:object to find the linked dataset resource
 * 4. Resolve the resource's actual URL from the resource list
 * 5. If no ViewAction found, fall back to the first Dataset resource
 */
export async function resolveROCrate(pid: string): Promise<string | null> {
  const roId = extractROId(pid);
  console.log(`[RO-Crate] Resolving ${pid} (id: ${roId})`);

  // Fetch annotations list (paginated response with results array)
  const annotResp = await fetch(`${ROHUB_API}ros/${roId}/annotations/`);
  if (!annotResp.ok) {
    console.error(
      `[RO-Crate] Failed to fetch annotations: ${annotResp.status}`
    );
    return null;
  }
  const annotData = await annotResp.json();
  const annotations: Annotation[] = annotData.results ?? annotData;

  // Collect all triples from all annotations
  const allTriples: Triple[] = [];
  for (const annot of annotations) {
    const triples = await fetchAnnotationTriples(annot.identifier);
    allTriples.push(...triples);
  }
  console.log(`[RO-Crate] Found ${allTriples.length} triples`);

  // Find ViewAction via potentialAction
  const actionTriple = allTriples.find((t) => t.predicate === POTENTIAL_ACTION);

  if (actionTriple) {
    const actionId = actionTriple.object;

    // Verify it's a ViewAction
    const typeTriple = allTriples.find(
      (t) => t.subject === actionId && t.predicate === RDF_TYPE
    );
    if (typeTriple?.object === VIEW_ACTION) {
      // Get the dataset resource URI from schema:object
      const objectTriple = allTriples.find(
        (t) => t.subject === actionId && t.predicate === SCHEMA_OBJECT
      );

      if (objectTriple) {
        // Resolve the resource URI to an actual URL
        const datasetUrl = await resolveResourceUrl(roId, objectTriple.object);
        if (datasetUrl) {
          console.log(
            `[RO-Crate] Resolved dataset via ViewAction: ${datasetUrl}`
          );
          return datasetUrl;
        }
      }

      // If schema:object resolution failed, check for urlTemplate
      const templateTriple = allTriples.find(
        (t) => t.subject === actionId && t.predicate === URL_TEMPLATE
      );
      if (templateTriple) {
        console.log(`[RO-Crate] Found urlTemplate: ${templateTriple.object}`);
      }
    }
  }

  // Fallback: find the first Dataset resource
  console.log(
    "[RO-Crate] No ViewAction found, falling back to Dataset resource"
  );
  return await findDatasetResource(roId);
}

/**
 * Resolve a resource URI to its actual URL via the ROHub resource list.
 */
async function resolveResourceUrl(
  roId: string,
  resourceUri: string
): Promise<string | null> {
  const resourceId = resourceUri.replace(/\/$/, "").split("/").pop()!;
  const resources = await fetchResources(roId);

  // Try exact match by ID
  const match = resources.find((r) => r.identifier === resourceId);
  if (match?.url) {
    return match.url;
  }

  // Fallback: find Dataset by type
  const dataset = resources.find((r) => r.type === "Dataset");
  return dataset?.url ?? null;
}

/**
 * Find the first Dataset resource in an RO.
 */
async function findDatasetResource(roId: string): Promise<string | null> {
  const resources = await fetchResources(roId);
  const dataset = resources.find((r) => r.type === "Dataset");
  if (dataset?.url) {
    console.log(`[RO-Crate] Found Dataset resource: ${dataset.url}`);
    return dataset.url;
  }
  return null;
}

/**
 * Fetch the resource list for an RO.
 */
async function fetchResources(roId: string): Promise<Resource[]> {
  const resp = await fetch(`${ROHUB_API}ros/${roId}/resources/`);
  if (!resp.ok) {
    return [];
  }
  const data = await resp.json();
  const results = data.results ?? data;
  return (Array.isArray(results) ? results : []).map(
    (r: Record<string, string>) => ({
      identifier: r.identifier,
      type: r.type,
      url: r.url,
    })
  );
}
