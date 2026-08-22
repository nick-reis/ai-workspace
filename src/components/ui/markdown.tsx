import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const NODE_CITATION_PREFIX = "workspace-node:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nodeCitationId(href: string | undefined) {
  if (!href?.startsWith(NODE_CITATION_PREFIX)) return null;
  const nodeId = href.slice(NODE_CITATION_PREFIX.length);
  return UUID_PATTERN.test(nodeId) ? nodeId : null;
}

function markdownUrlTransform(url: string) {
  return nodeCitationId(url) ? url : defaultUrlTransform(url);
}

export function Markdown({
  children,
  className,
  onNodeCitationClick,
}: {
  children: string;
  className?: string;
  onNodeCitationClick?: (nodeId: string) => void;
}) {
  return (
    <div className={cn("markdown text-sm leading-7 text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={{
        h1: ({ children: content }) => <h1 className="mt-6 mb-3 text-2xl font-semibold tracking-tight first:mt-0">{content}</h1>,
        h2: ({ children: content }) => <h2 className="mt-6 mb-3 text-xl font-semibold tracking-tight first:mt-0">{content}</h2>,
        h3: ({ children: content }) => <h3 className="mt-5 mb-2 text-lg font-semibold first:mt-0">{content}</h3>,
        h4: ({ children: content }) => <h4 className="mt-4 mb-2 text-base font-semibold first:mt-0">{content}</h4>,
        p: ({ children: content }) => <p className="my-3 first:mt-0 last:mb-0">{content}</p>,
        strong: ({ children: content }) => <strong className="font-semibold">{content}</strong>,
        em: ({ children: content }) => <em className="italic">{content}</em>,
        ul: ({ children: content }) => <ul className="my-3 list-disc space-y-1 pl-6 marker:text-muted-foreground">{content}</ul>,
        ol: ({ children: content }) => <ol className="my-3 list-decimal space-y-1 pl-6 marker:text-muted-foreground">{content}</ol>,
        li: ({ children: content, className: itemClassName }) => <li className={cn("pl-1", itemClassName)}>{content}</li>,
        blockquote: ({ children: content }) => <blockquote className="my-4 rounded-r-xl border-l-2 border-foreground/20 bg-muted/55 px-4 py-2 text-muted-foreground">{content}</blockquote>,
        a: ({ href, children: content }) => {
          const nodeId = nodeCitationId(href);
          return nodeId ? (
            <button
              type="button"
              className="mx-0.5 inline-flex max-w-[240px] translate-y-[0.18em] items-center gap-1 rounded-full border border-border/80 bg-card px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground shadow-2xs transition-colors hover:border-foreground/25 hover:text-foreground disabled:cursor-default"
              disabled={!onNodeCitationClick}
              title="Open this note in response sources"
              onClick={() => onNodeCitationClick?.(nodeId)}
            >
              <Icon icon={File01Icon} className="size-3 shrink-0" />
              <span className="truncate">{content}</span>
            </button>
          ) : <a href={href} target="_blank" rel="noreferrer" className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">{content}</a>;
        },
        hr: () => <hr className="my-6 border-border" />,
        pre: ({ children: content }) => <pre className="my-4 overflow-x-auto rounded-xl border border-border/75 bg-muted/65 p-4 text-[13px] leading-6 shadow-2xs">{content}</pre>,
        code: ({ className: codeClassName, children: content, ...props }) => <code className={cn("rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.88em]", codeClassName)} {...props}>{content}</code>,
        table: ({ children: content }) => <div className="my-4 overflow-x-auto rounded-xl border border-border"><table className="w-full border-collapse text-left text-sm">{content}</table></div>,
        thead: ({ children: content }) => <thead className="bg-muted/70">{content}</thead>,
        th: ({ children: content }) => <th className="border-b border-border px-3 py-2 font-semibold">{content}</th>,
        td: ({ children: content }) => <td className="border-b border-border/60 px-3 py-2 align-top last:border-b-0">{content}</td>,
        img: ({ src, alt }) => <img src={src} alt={alt ?? ""} className="my-4 max-h-[480px] max-w-full rounded-xl border border-border object-contain shadow-xs" />,
        input: ({ type, checked }) => type === "checkbox" ? <input type="checkbox" checked={checked} readOnly className="mr-2 accent-foreground" /> : null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
