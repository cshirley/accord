export interface ImpactFeature {
  id: string;
  status?: string;
  anchors?: { code?: string[] };
  depends_on?: string[];
  related?: string[];
}

export interface ImpactIndex {
  features: ImpactFeature[];
}

export interface ImpactPlan {
  tasks: Array<{ id: number; files: Array<{ path: string; action: string }> }>;
}

export interface ImpactRow {
  slug: string;
  relation: "new" | "extends" | "modifies" | "deprecates" | "depends_on";
  delta?: string;
}

export interface ImpactDecision {
  kind: "overlap" | "contradiction";
  question: string;
  context: string;
}

export interface ImpactResult {
  rows: ImpactRow[];
  decisions: ImpactDecision[];
}

const normalisePath = (path: string): string => path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

const DIRECT_PRIORITY: ImpactRow["relation"][] = ["deprecates", "modifies", "extends"];

function directRelation(action: string): ImpactRow["relation"] {
  if (action === "delete") return "deprecates";
  if (action === "add") return "extends";
  return "modifies";
}

export function analyseImpact(plan: ImpactPlan, index: ImpactIndex): ImpactResult {
  const features = index.features ?? [];
  const bySlug = new Map(features.map((feature) => [feature.id, feature]));
  const direct = new Map<string, ImpactRow["relation"]>();
  const decisions: ImpactDecision[] = [];
  const overlapPaths = new Set<string>();
  const contradicted = new Set<string>();

  for (const task of plan.tasks) {
    for (const file of task.files) {
      const path = normalisePath(file.path);
      const owners = features.filter((feature) => feature.anchors?.code?.includes(path));
      if (owners.length === 0) continue;
      const relation = directRelation(file.action);
      for (const owner of owners) {
        const current = direct.get(owner.id);
        if (!current || DIRECT_PRIORITY.indexOf(relation) < DIRECT_PRIORITY.indexOf(current)) {
          direct.set(owner.id, relation);
        }
        const retired = owner.status === "deprecated" || owner.status === "superseded";
        if (retired && file.action !== "delete" && !contradicted.has(owner.id)) {
          contradicted.add(owner.id);
          decisions.push({
            kind: "contradiction",
            question: `Plan changes ${path}, anchored by ${owner.status} feature ${owner.id}. Proceed?`,
            context: `Feature ${owner.id} is ${owner.status}; plan action "${file.action}" on ${path} contradicts it.`,
          });
        }
      }
      if (owners.length > 1 && !overlapPaths.has(path)) {
        overlapPaths.add(path);
        const slugs = owners.map((owner) => owner.id).join(", ");
        decisions.push({
          kind: "overlap",
          question: `Plan touches ${path}, anchored by several features (${slugs}). Which owns the change?`,
          context: `Features ${slugs} all anchor ${path}.`,
        });
      }
    }
  }

  const rows: ImpactRow[] = [...direct].map(([slug, relation]) => ({
    slug,
    relation,
    delta: `${relation} via plan files anchored by ${slug}`,
  }));

  const seen = new Set(direct.keys());
  const queue = [...direct.keys()];
  while (queue.length > 0) {
    const slug = queue.shift() as string;
    const feature = bySlug.get(slug);
    if (!feature) continue;
    for (const next of [...(feature.depends_on ?? []), ...(feature.related ?? [])]) {
      if (seen.has(next) || !bySlug.has(next)) continue;
      seen.add(next);
      rows.push({
        slug: next,
        relation: "depends_on",
        delta: `reached from ${slug} by depends_on/related traversal`,
      });
      queue.push(next);
    }
  }

  return { rows, decisions };
}
