/// <reference types="jest" />

import { breakpointForWidth } from "../breakpoint";

describe("breakpointForWidth", () => {
  it("maps widths below 600dp to phone", () => {
    expect(breakpointForWidth(0)).toBe("phone");
    expect(breakpointForWidth(320)).toBe("phone");
    expect(breakpointForWidth(599)).toBe("phone");
  });

  it("maps 600–839dp to compact tablet", () => {
    expect(breakpointForWidth(600)).toBe("compact");
    expect(breakpointForWidth(720)).toBe("compact");
    expect(breakpointForWidth(839)).toBe("compact");
  });

  it("maps 840dp and above to tablet", () => {
    expect(breakpointForWidth(840)).toBe("tablet");
    expect(breakpointForWidth(1024)).toBe("tablet");
    expect(breakpointForWidth(2560)).toBe("tablet");
  });
});
