import type { CSSProperties, ReactNode } from "react";
import "../styles.css";

type RenderMode = "csr" | "ssr" | "ssg" | "ppr" | "rsc";

interface RenderModePageProps {
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
  description: string;
  mode: RenderMode;
  title: string;
}

const modeStyles: Record<
  RenderMode,
  {
    background: string;
    border: string;
    chipBackground: string;
    chipColor: string;
  }
> = {
  csr: {
    background:
      "linear-gradient(135deg, #eff6ff 0%, #f8fafc 48%, #ecfeff 100%)",
    border: "#38bdf8",
    chipBackground: "#e0f2fe",
    chipColor: "#075985",
  },
  ssr: {
    background:
      "linear-gradient(135deg, #ecfdf5 0%, #f8fafc 48%, #e0f2fe 100%)",
    border: "#10b981",
    chipBackground: "#d1fae5",
    chipColor: "#065f46",
  },
  ssg: {
    background:
      "linear-gradient(135deg, #f0fdfa 0%, #f8fafc 48%, #fefce8 100%)",
    border: "#14b8a6",
    chipBackground: "#ccfbf1",
    chipColor: "#115e59",
  },
  ppr: {
    background:
      "linear-gradient(135deg, #fff7ed 0%, #f8fafc 48%, #fef3c7 100%)",
    border: "#f59e0b",
    chipBackground: "#ffedd5",
    chipColor: "#9a3412",
  },
  rsc: {
    background:
      "linear-gradient(135deg, #f5f3ff 0%, #f8fafc 48%, #eef2ff 100%)",
    border: "#8b5cf6",
    chipBackground: "#ede9fe",
    chipColor: "#5b21b6",
  },
};

const criticalStyles = `
body{margin:0;color:#172033;background:#f5f7fb;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.layout{display:grid;gap:16px;max-width:1040px;margin:0 auto;padding:28px 20px}
.render-page{max-width:none;min-height:100vh;margin:0;padding:28px max(20px,calc((100vw - 1040px) / 2 + 20px))}
.render-page>*{width:min(100%,1040px);margin-right:auto;margin-left:auto;box-sizing:border-box}
.page-back-link{display:inline-flex;width:max-content;align-items:center;gap:8px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;padding:8px 12px;color:#1769e0;font-weight:700;text-decoration:none;box-shadow:0 1px 2px rgb(23 32 51 / 6%)}.page-back-link:hover{text-decoration:none;background:#f8fafc}
.render-mode-banner{display:flex;flex-wrap:wrap;gap:10px;align-items:center;border:1px solid;border-left-width:6px;border-radius:8px;background:rgb(255 255 255 / 78%);padding:12px 14px;color:#334155;box-shadow:0 1px 2px rgb(23 32 51 / 6%)}
.render-mode-chip{display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.panel{border:1px solid #d8deea;border-radius:8px;background:#fff;padding:20px;box-shadow:0 1px 2px rgb(23 32 51 / 5%)}
.hero-panel,.split-panel,.ppr-region-panel{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,320px);gap:20px;align-items:stretch}
.hero-panel h1{margin:0 0 10px;font-size:34px;line-height:1.08}
.hero-panel p{max-width:720px;color:#475569}
.hero-panel--csr{border-left:6px solid #38bdf8}.hero-panel--ssr{border-left:6px solid #10b981}.hero-panel--ssg{border-left:6px solid #14b8a6}.hero-panel--ppr{border-left:6px solid #f59e0b}.hero-panel--rsc{border-left:6px solid #8b5cf6}
.meta-list{display:grid;gap:10px;margin:0}.meta-list div{display:grid;grid-template-columns:82px minmax(0,1fr);gap:12px;align-items:baseline;border:1px solid #e4e9f2;border-radius:8px;padding:10px 12px;background:#f8fafc}.meta-list dt{color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase}.meta-list dd{min-width:0;margin:0;overflow-wrap:anywhere;font-weight:700}
.status-grid,.card-grid,.campaign-segments,.recommendation-grid,.inventory-grid,.triage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.status,.mini-card,.segment-card,.recommendation-card,.inventory-card,.triage-grid article{border:1px solid #e4e9f2;border-radius:8px;background:#fff;padding:12px}
.status h2,.panel h2{margin:0 0 8px;font-size:16px}.status strong{display:block;margin-bottom:4px;color:#111827;font-size:24px}.status span,.muted,.section-header span,.mini-card span,.signal-list em{color:#64748b;font-size:13px}
.eyebrow{margin:0 0 8px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.section-header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-top:1px solid #e4e9f2;padding:10px 8px;text-align:left}th{color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase}
.signal-list{display:grid;gap:8px;padding:0;list-style:none}.signal-list li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;border:1px solid #e4e9f2;border-radius:8px;padding:10px 12px}
.badge{display:inline-flex;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;padding:4px 10px;color:#3730a3;font-size:13px;font-weight:700}.client-island-card{display:grid;gap:10px;align-content:center;border:1px solid #c7d2fe;border-radius:8px;background:#f5f3ff;padding:16px}
.recommendation-card{border-color:#ddd6fe;background:#faf5ff}.recommendation-card h3{margin:0 0 10px;font-size:18px}.recommendation-card strong{display:inline-flex;margin-bottom:8px;border-radius:999px;background:#ede9fe;padding:4px 10px;color:#5b21b6;font-size:13px}
.policy-lanes{display:grid;gap:10px}.policy-lane{display:grid;grid-template-columns:minmax(180px,1fr) minmax(140px,220px) minmax(120px,auto);gap:14px;align-items:center;border:1px solid #e4e9f2;border-radius:8px;padding:12px}.policy-lane div{display:grid;gap:4px}.policy-lane span,.policy-lane em{color:#64748b;font-size:13px}.policy-lane em{font-style:normal;font-weight:700}
.segment-card{border-color:#fed7aa;background:#fff7ed}.segment-card span{display:inline-flex;margin-bottom:8px;border-radius:999px;background:#ffedd5;padding:3px 9px;color:#9a3412;font-size:12px;font-weight:800;text-transform:uppercase}.segment-card h3{margin:0 0 8px}.segment-card p{color:#64748b}
.region-placeholder{display:grid;gap:8px;border:1px dashed #f59e0b;border-radius:8px;background:#fffbeb;padding:18px}.region-placeholder span{width:100%;height:10px;border-radius:999px;background:linear-gradient(90deg,#fde68a,#fef3c7,#fde68a)}.region-placeholder strong{color:#92400e}.region-placeholder em{color:#b45309;font-size:13px;font-style:normal}
.region-card{border:1px solid #bbf7d0;border-radius:8px;background:#f0fdf4;padding:14px}.inventory-card{display:grid;gap:6px;border-color:#bbf7d0}.inventory-card span,.inventory-card em{color:#64748b;font-size:13px}.inventory-card em{font-style:normal}
@media (max-width:760px){.hero-panel,.split-panel,.ppr-region-panel,.policy-lane{grid-template-columns:1fr}}
`;

export default function RenderModePage({
  backHref,
  backLabel = "Back to control center",
  children,
  description,
  mode,
  title,
}: RenderModePageProps) {
  const style = modeStyles[mode];

  return (
    <>
      <style>{criticalStyles}</style>
      <main
        className={`layout render-page render-page--${mode}`}
        data-render-mode={mode}
        data-testid="render-mode-page"
        style={{ background: style.background } as CSSProperties}
      >
        {backHref ? (
          <a
            className="page-back-link"
            data-testid="page-back-link"
            href={backHref}
          >
            {backLabel}
          </a>
        ) : null}
        <section
          className="render-mode-banner"
          style={{ borderColor: style.border } as CSSProperties}
        >
          <span
            className="render-mode-chip"
            data-testid="render-mode-chip"
            style={
              {
                background: style.chipBackground,
                color: style.chipColor,
              } as CSSProperties
            }
          >
            {title}
          </span>
          <span>{description}</span>
        </section>
        {children}
      </main>
    </>
  );
}
