import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StaggerChildren } from "./stagger-children";

const fromTo = vi.hoisted(() => vi.fn(() => ({ kill: vi.fn() })));

vi.mock("gsap", () => ({ gsap: { fromTo } }));

describe("StaggerChildren", () => {
  beforeEach(() => {
    fromTo.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  });

  it("waits until ready and does not replay for child updates", () => {
    const view = render(<StaggerChildren ready={false}><span>First</span></StaggerChildren>);
    expect(fromTo).not.toHaveBeenCalled();

    view.rerender(<StaggerChildren ready><span>First</span></StaggerChildren>);
    expect(fromTo).toHaveBeenCalledTimes(1);

    view.rerender(<StaggerChildren ready><span>Second</span></StaggerChildren>);
    expect(fromTo).toHaveBeenCalledTimes(1);
  });

  it("removes translation and timing for reduced motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<StaggerChildren ready><span>First</span></StaggerChildren>);

    expect(fromTo).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ y: 0 }),
      expect.objectContaining({ delay: 0, duration: 0, stagger: 0 }),
    );
  });
});
