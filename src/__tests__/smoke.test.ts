/// <reference types="jest" />

import "../polyfills/text-encoding";
import { colors, orderStateColor } from "../theme/colors";

describe("smoke", () => {
  it("exposes the Crays palette", () => {
    expect(colors.pink).toBe("#F50A48");
    expect(colors.night).toBe("#160A11");
    expect(orderStateColor.fulfilled).toBe(colors.success);
  });

  it("installs TextEncoder/TextDecoder polyfills", () => {
    const encoded = new TextEncoder().encode("crays");
    expect(Array.from(encoded)).toEqual([99, 114, 97, 121, 115]);
    expect(new TextDecoder().decode(encoded)).toBe("crays");
  });
});
