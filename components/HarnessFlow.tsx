import type { HarnessStep } from "../lib/demo-flow";

const stateCopy: Record<HarnessStep["state"], string> = {
  complete: "Complete",
  active: "Running",
  blocked: "Blocked",
  queued: "Queued",
};

export function HarnessFlow({ steps }: { steps: HarnessStep[] }) {
  return (
    <aside className="flowPanel" aria-label="Harness flow visual">
      <div className="flowHeader">
        <p className="eyebrow">Live harness flow</p>
        <h2>Bug fix run</h2>
        <span className="runId">RUN-0001</span>
      </div>
      <div className="flowRail">
        {steps.map((step, index) => (
          <div className={`flowStep ${step.state}`} key={step.id}>
            <div className="nodeWrap">
              <div className="node">{index + 1}</div>
              {index < steps.length - 1 ? <div className="connector" /> : null}
            </div>
            <div className="stepCard">
              <div className="stepTopline">
                <h3>{step.label}</h3>
                <span>{stateCopy[step.state]}</span>
              </div>
              <p>{step.description}</p>
              <code>{step.artifact}</code>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
