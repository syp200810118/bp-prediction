// ---------------------------------------------------------------------------
// Backend API configuration — edit this file to match your ML backend.
// ---------------------------------------------------------------------------
window.BP_CONFIG = {
  // Full URL of the prediction endpoint.
  API_URL: "http://localhost:8000/predict",

  // Region / tier dropdown options. `value` is what is sent to the backend.
  // "ALL" means no filter — the model should use data from every region / tier.
  REGIONS: [
    { value: "ALL", label: "All regions" },
    { value: "NA1", label: "North America" },
    { value: "EUW1", label: "Europe West" },
    { value: "EUN1", label: "Europe Nordic & East" },
    { value: "KR", label: "Korea" },
    { value: "JP1", label: "Japan" },
    { value: "BR1", label: "Brazil" },
    { value: "LA1", label: "Latin America North" },
    { value: "LA2", label: "Latin America South" },
    { value: "OC1", label: "Oceania" },
    { value: "TR1", label: "Turkey" },
    { value: "RU", label: "Russia" },
    { value: "ME1", label: "Middle East" },
    { value: "SG2", label: "Southeast Asia" },
    { value: "TW2", label: "Taiwan" },
    { value: "VN2", label: "Vietnam" },
  ],
  // `icon` is the ranked crest shown next to each tier in the dropdown.
  TIERS: [
    { value: "ALL", label: "All tiers", icon: "unranked" },
    { value: "IRON", label: "Iron" },
    { value: "BRONZE", label: "Bronze" },
    { value: "SILVER", label: "Silver" },
    { value: "GOLD", label: "Gold" },
    { value: "PLATINUM", label: "Platinum" },
    { value: "EMERALD", label: "Emerald" },
    { value: "DIAMOND", label: "Diamond" },
    { value: "MASTER", label: "Master" },
    { value: "GRANDMASTER", label: "Grandmaster" },
    { value: "CHALLENGER", label: "Challenger" },
  ].map((t) => ({
    ...t,
    icon: `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${t.icon || t.value.toLowerCase()}.svg`,
  })),
  DEFAULT_REGION: "ALL",
  DEFAULT_TIER: "ALL",

  // Builds the JSON body sent to the backend.
  // `blue` / `red` are arrays of 5 picks in role order (top, jungle, mid, bot, support).
  // Each pick: { id: "MonkeyKing", key: 62, name: "Wukong" }
  //   id   = Data Dragon champion id (string)
  //   key  = Riot numeric champion id
  //   name = display name
  // `region` / `tier` are the selected dropdown values, e.g. "KR" / "DIAMOND", or "ALL".
  // In Pro draft mode the same payload is sent: bans and series context are not passed.
  buildPayload(blue, red, region, tier) {
    return {
      region,
      tier,
      // bp-prediction-api expects Riot numeric keys (the model was trained on match-v5 championId)
      blue: blue.map((c) => c.key),
      red: red.map((c) => c.key),
    };
  },

  // Turns the backend's JSON response into { blue, red } win probabilities (0..1).
  // The default accepts several common shapes, e.g.
  //   { "blue_win_rate": 0.56, "red_win_rate": 0.44 }
  //   { "blue": 56.0, "red": 44.0 }
  //   { "blue_win_prob": 0.56 }
  parseResponse(data) {
    const pick = (...keys) => keys.map((k) => data[k]).find((v) => typeof v === "number");
    let blue = pick("blue_win_rate", "blue_win_prob", "blue_win", "blue", "blueWinRate");
    let red = pick("red_win_rate", "red_win_prob", "red_win", "red", "redWinRate");
    if (blue === undefined && red === undefined) throw new Error("Unrecognised response: " + JSON.stringify(data));
    const scale = (blue ?? 0) > 1 || (red ?? 0) > 1 ? 100 : 1; // accept percentages
    if (blue !== undefined) blue /= scale;
    if (red !== undefined) red /= scale;
    if (blue === undefined) blue = 1 - red;
    if (red === undefined) red = 1 - blue;
    return { blue, red };
  },
};
