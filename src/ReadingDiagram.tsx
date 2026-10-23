import { useId, useState } from "react";
import { ArrowRight, BookOpen, Check, GitCompare, Layers3 } from "lucide-react";
import type { ReadingGuide } from "./types";

const kindLabels = { method: "方法拆解", analysis: "现象分析", benchmark: "评测设计" };

export function ReadingDiagram({ guide }: { guide: ReadingGuide }) {
  const diagram = guide.diagram;
  const [active, setActive] = useState(diagram?.nodes[0]?.id ?? "");
  const explanationId = useId();
  if (!diagram) return null;
  const selected = diagram.nodes.find((node) => node.id === active) ?? diagram.nodes[0];
  const Icon = guide.kind === "method" ? Layers3 : guide.kind === "analysis" ? BookOpen : GitCompare;
  return (
    <section className={`reading-diagram diagram-${diagram.layout}`} aria-label={`${kindLabels[guide.kind]}图解`}>
      <div className="diagram-heading"><span><Icon size={16} aria-hidden="true" />{kindLabels[guide.kind]}</span><small>点击模块查看解释</small></div>
      <h3>{diagram.title}</h3>
      <div className="diagram-nodes" role="group" aria-label="概念图模块">
        {diagram.nodes.map((node, index) => (
          <div className="diagram-node-wrap" key={node.id}>
            <button type="button" className={`diagram-node ${selected.id === node.id ? "selected" : ""}`} aria-pressed={selected.id === node.id} aria-controls={explanationId} onClick={() => setActive(node.id)}>
              <span>{String(index + 1).padStart(2, "0")}</span><strong>{node.title}</strong>{selected.id === node.id && <Check size={14} aria-hidden="true" />}
            </button>
            {index < diagram.nodes.length - 1 && diagram.layout !== "paired" && <ArrowRight className="diagram-arrow" size={16} aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="diagram-explanation" id={explanationId} aria-live="polite"><strong>{selected.title}</strong><p>{selected.description}</p></div>
      <p className="diagram-caption">{diagram.caption}</p>
    </section>
  );
}
