export interface NightDropCharacter {
  readonly id: "dash" | "mara" | "clamp";
  readonly name: string;
  readonly role: string;
  readonly assetAlias: string | null;
  readonly presentationHooks: Readonly<Record<string, string>>;
}

export const NIGHT_DROP_CHARACTERS: readonly NightDropCharacter[] = [
  {
    id: "dash",
    name: "Dash",
    role: "Runner",
    assetAlias: "character.runner",
    presentationHooks: {
      idle: "dash.idle",
      move: "dash.route-step",
      collect: "dash.package-collect",
      destination: "dash.destination-arrive",
    },
  },
  {
    id: "mara",
    name: "Mara",
    role: "Dispatcher",
    assetAlias: null,
    presentationHooks: {
      roundStart: "mara.dispatch",
      priorityJob: "mara.priority-job",
      recovery: "mara.recovery",
    },
  },
  {
    id: "clamp",
    name: "Clamp",
    role: "Enforcement officer",
    assetAlias: "character.enforcement",
    presentationHooks: {
      appear: "clamp.arrive",
      inspect: "clamp.inspect",
      leave: "clamp.leave",
    },
  },
] as const;

export const NIGHT_DROP_COPY = {
  ready: "Mara: Quiet night. Which is usually when Dash gets creative.",
  playing: "Mara: Package is moving. Definition of ‘carefully’ remains under review.",
  clamp: "Clamp: Your shortcut has paperwork now.",
  recovered: "Mara: We are back. Nobody touch anything clever.",
  destination: "Mara: Delivered. Against several excellent reasons.",
} as const;
