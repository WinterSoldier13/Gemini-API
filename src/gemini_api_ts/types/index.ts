export interface Gem {
  id: string;
  name: string;
  description: string;
  prompt: string;
  predefined: boolean;
}

export class GemJar {
  gems: Map<string, Gem>;

  constructor(gems: Iterable<[string, Gem]>) {
    this.gems = new Map(gems);
  }

  get(gemId: string): Gem | undefined {
    return this.gems.get(gemId);
  }

  list(): Gem[] {
    return Array.from(this.gems.values());
  }
}

export interface WebImage {
  url: string;
  title: string;
  alt: string;
  proxy?: string;
}

export interface GeneratedImage {
  url: string;
  title: string;
  alt: string;
  proxy?: string;
  cookies?: Record<string, string>;
}

export interface Candidate {
  rcid: string;
  text: string;
  thoughts?: string;
  webImages: WebImage[];
  generatedImages: GeneratedImage[];
}

export interface ModelOutput {
  metadata: string[]; // [cid, rid, rcid]
  candidates: Candidate[];
  chosen: number;
  rcid: string;
  text: string;
  images: (WebImage | GeneratedImage)[];
}

export class RPCData {
  rpcid: string;
  payload: string;
  identifier?: string;

  constructor(rpcid: string, payload: string, identifier?: string) {
    this.rpcid = rpcid;
    this.payload = payload;
    this.identifier = identifier;
  }

  serialize(): any[] {
    return [this.rpcid, this.payload, null, this.identifier];
  }
}
