import { useMemo, useState } from "react";
import { marked } from "marked";
import type { State } from "@/lib/api";

type Props = { state: State; brand: string };

// Markdown comes from the user's own repository and is rendered in the user's own local tool.
// Raw HTML in it is escaped so a pasted snippet cannot run script in the UI.
marked.use({ renderer: { html: ({ text }) => text.replace(/</g, "&lt;") } });

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text, { async: false }) as string, [text]);
  return (
    <div
      className="max-w-[72ch] text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:my-1 [&_p]:my-2 [&_table]:my-3 [&_table]:w-full [&_td]:border-t [&_td]:py-1.5 [&_td]:pr-3 [&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function GuidelinesView({ state, brand }: Props) {
  const docs = [
    { id: "brand", label: `${brand} design`, text: state.guidelines.brands[brand], file: `brands/${brand}/DESIGN.md` },
    { id: "shared", label: "Shared design", text: state.guidelines.shared, file: "DESIGN.md" },
    { id: "writing", label: "Writing", text: state.guidelines.writing, file: "WRITING.md" },
  ];
  const [active, setActive] = useState("brand");
  const doc = docs.find((d) => d.id === active) ?? docs[0];
  return (
    <div className="flex flex-wrap items-start gap-4">
      <nav aria-label="Guideline documents" className="flex min-w-0 flex-[1_1_200px] flex-col gap-1 md:max-w-56">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            aria-current={d.id === active}
            onClick={() => setActive(d.id)}
            className={`rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${d.id === active ? "bg-accent font-medium text-accent-foreground" : ""}`}
          >
            {d.label}
            <span className="block font-mono text-xs text-muted-foreground">{d.file}</span>
          </button>
        ))}
      </nav>
      <article className="min-w-0 flex-[999_1_480px] rounded-xl border bg-card p-6">
        {doc.text ? <Markdown text={doc.text} /> : <p className="text-sm text-muted-foreground">{doc.file} does not exist yet. Ask Claude to write it.</p>}
      </article>
    </div>
  );
}
