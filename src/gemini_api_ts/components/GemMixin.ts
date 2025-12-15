import { Gem, GemJar, RPCData } from "../types";
import { GRPC } from "../constants";
import { APIError } from "../exceptions";
import { logger } from "../utils/logger";

export class GemMixin {
  _gems: GemJar | null = null;

  // These are expected to be available on the instance mixing this in
  // We use `any` here to avoid circular dependency or complex type definitions
  _batchExecute(payloads: RPCData[], kwargs?: any): Promise<any> {
    return (this as any)._batchExecute(payloads, kwargs);
  }
  close(): Promise<void> {
     return (this as any).close();
  }

  get gems(): GemJar {
    if (!this._gems) {
      throw new Error(
        "Gems not fetched yet. Call `GeminiClient.fetch_gems()` method to fetch gems from gemini.google.com."
      );
    }
    return this._gems;
  }

  async fetchGems(includeHidden: boolean = false): Promise<GemJar> {
    const response = await this._batchExecute([
      new RPCData(
        GRPC.LIST_GEMS,
        includeHidden ? "[4]" : "[3]",
        "system"
      ),
      new RPCData(GRPC.LIST_GEMS, "[2]", "custom"),
    ]);

    try {
        // response.data is text
      const responseLines = response.data.split("\n");
      // Python: json.loads(response.text.split("\n")[2])
      // Assuming structure is similar
      let responseJson;
      for (const line of responseLines) {
           try {
               responseJson = JSON.parse(line);
               if (Array.isArray(responseJson)) break;
           } catch(e) {}
      }

      // If we didn't find the array in lines, maybe the whole thing is array?
      if (!responseJson) responseJson = JSON.parse(response.data);

      let predefinedGems: any[] = [];
      let customGems: any[] = [];

      for (const part of responseJson) {
        if (part[part.length - 1] === "system") {
            const inner = JSON.parse(part[2]);
            if (inner && inner[2]) predefinedGems = inner[2];
        } else if (part[part.length - 1] === "custom") {
             const inner = JSON.parse(part[2]);
             if (inner && inner[2]) customGems = inner[2];
        }
      }

      if (predefinedGems.length === 0 && customGems.length === 0) {
           // It's possible to have no gems, but if the response structure was wrong we might want to error?
           // The python code raises Exception if both are empty.
           // However, user might genuinely have no custom gems and system gems might fail to load?
           // I'll follow python logic.
           // Wait, python code: `if not predefined_gems and not custom_gems: raise Exception`
           // But `predefined_gems` comes from "system", which should exist.
           throw new Error("No gems found");
      }

      const allGems: [string, Gem][] = [];

      for (const gem of predefinedGems) {
          allGems.push([
              gem[0],
              {
                  id: gem[0],
                  name: gem[1][0],
                  description: gem[1][1],
                  prompt: gem[2] && gem[2][0] || null,
                  predefined: true
              }
          ])
      }

       for (const gem of customGems) {
          allGems.push([
              gem[0],
              {
                  id: gem[0],
                  name: gem[1][0],
                  description: gem[1][1],
                  prompt: gem[2] && gem[2][0] || null,
                  predefined: false
              }
          ])
      }

      this._gems = new GemJar(allGems);
      return this._gems;

    } catch (e: any) {
        await this.close();
        logger.debug(`Invalid response: ${response.data}`);
        throw new APIError(
            "Failed to fetch gems. Invalid response data received. Client will try to re-initialize on next request."
        );
    }
  }

  async createGem(name: string, prompt: string, description: string = ""): Promise<Gem> {
      const response = await this._batchExecute([
          new RPCData(
              GRPC.CREATE_GEM,
              JSON.stringify([
                  [
                    name,
                    description,
                    prompt,
                    null,
                    null,
                    null,
                    null,
                    null,
                    0,
                    null,
                    1,
                    null,
                    null,
                    null,
                    [],
                  ]
              ])
          )
      ]);

      try {
           const responseLines = response.data.split("\n");
           let responseJson;
            for (const line of responseLines) {
                try {
                    responseJson = JSON.parse(line);
                     if (Array.isArray(responseJson) && responseJson[0] && responseJson[0][2]) break;
                } catch(e) {}
            }
             if (!responseJson) responseJson = JSON.parse(response.data);

             const gemId = JSON.parse(responseJson[0][2])[0];
             return {
                 id: gemId,
                 name,
                 description,
                 prompt,
                 predefined: false
             };

      } catch (e) {
          await this.close();
           logger.debug(`Invalid response: ${response.data}`);
            throw new APIError(
                "Failed to create gem. Invalid response data received. Client will try to re-initialize on next request."
            );
      }
  }

  async updateGem(gem: Gem | string, name: string, prompt: string, description: string = ""): Promise<Gem> {
      const gemId = typeof gem === 'string' ? gem : gem.id;

      await this._batchExecute([
          new RPCData(
              GRPC.UPDATE_GEM,
               JSON.stringify([
                    gemId,
                    [
                        name,
                        description,
                        prompt,
                        null,
                        null,
                        null,
                        null,
                        null,
                        0,
                        null,
                        1,
                        null,
                        null,
                        null,
                        [],
                        0,
                    ],
                ])
          )
      ]);

      return {
          id: gemId,
          name,
          description,
          prompt,
          predefined: false
      };
  }

  async deleteGem(gem: Gem | string, kwargs?: any): Promise<void> {
      const gemId = typeof gem === 'string' ? gem : gem.id;

      await this._batchExecute(
          [new RPCData(GRPC.DELETE_GEM, JSON.stringify([gemId]))],
          kwargs
      );
  }
}
