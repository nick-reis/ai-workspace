import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders common and GitHub-flavored Markdown structures", () => {
    render(
      <Markdown>{`# Heading

- List item
- [x] Finished task

| Name | State |
| --- | --- |
| Graph | Ready |

> Quoted text

\`inline code\`

\`\`\`ts
const connected = true;
\`\`\`

[OpenAI](https://openai.com)`}</Markdown>,
    );

    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.getByText("List item")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Quoted text")).toBeInTheDocument();
    expect(screen.getByText("inline code")).toBeInTheDocument();
    expect(screen.getByText("const connected = true;")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OpenAI" })).toHaveAttribute("target", "_blank");
  });

  it("renders validated workspace node links as citation pills", () => {
    const nodeId = "11111111-1111-4111-8111-111111111111";
    const onCitation = vi.fn();
    render(<Markdown onNodeCitationClick={onCitation}>{`Updated [Cooking Ideas](workspace-node:${nodeId}).`}</Markdown>);

    const citation = screen.getByRole("button", { name: "Cooking Ideas" });
    fireEvent.click(citation);
    expect(onCitation).toHaveBeenCalledWith(nodeId);
  });
});
