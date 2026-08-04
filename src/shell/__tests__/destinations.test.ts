/// <reference types="jest" />

import { DESTINATIONS, visibleDestinations } from "../destinations";

const ALL = DESTINATIONS.map((d) => d.id);

describe("visibleDestinations", () => {
  it("shows every destination to the admin persona", () => {
    expect(visibleDestinations(["store", "events", "moderation", "invites", "settings"])).toEqual(ALL);
  });

  it("always keeps Home, even with no permissions", () => {
    expect(visibleDestinations([])).toEqual(["home"]);
  });

  it("gates orders and menu on store, with events also opening orders", () => {
    expect(visibleDestinations(["store"])).toEqual(["home", "orders", "menu"]);
    expect(visibleDestinations(["events"])).toEqual(["home", "orders", "events"]);
  });

  it("opens people on moderation or settings", () => {
    expect(visibleDestinations(["moderation"])).toEqual(["home", "people"]);
    expect(visibleDestinations(["settings"])).toEqual(["home", "people", "settings"]);
  });

  it("gates invites on the invites permission", () => {
    expect(visibleDestinations(["invites"])).toEqual(["home", "invites"]);
  });

  it("preserves the canonical destination order", () => {
    expect(visibleDestinations(["settings", "store"])).toEqual(["home", "orders", "menu", "people", "settings"]);
  });
});
