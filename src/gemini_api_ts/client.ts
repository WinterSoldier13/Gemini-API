import axios, { AxiosInstance, AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { HttpsProxyAgent } from "https-proxy-agent";
import path from "path";

import { GemMixin } from "./components/GemMixin";
import { Endpoint, Headers, Model, ErrorCode } from "./constants";
import {
  APIError,
  AuthError,
  GeminiError,
  ImageGenerationError,
  ModelInvalid,
  TemporarilyBlocked,
  TimeoutError,
  UsageLimitExceeded,
} from "./exceptions";
import {
  Candidate,
  Gem,
  GeneratedImage,
  ModelOutput,
  RPCData,
  WebImage,
} from "./types";
import {
  extractJsonFromResponse,
  getAccessToken,
  getNestedValue,
  logger,
  parseFileName,
  rotate1PSIDTS,
  uploadFile,
} from "./utils";

// Helper to apply mixins
function applyMixins(derivedCtor: any, constructors: any[]) {
  constructors.forEach((baseCtor) => {
    Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
      Object.defineProperty(
        derivedCtor.prototype,
        name,
        Object.getOwnPropertyDescriptor(baseCtor.prototype, name) ||
          Object.create(null)
      );
    });
  });
}

export class GeminiClient {
  cookies: Record<string, string>;
  proxy?: string;
  _running: boolean;
  client?: AxiosInstance;
  accessToken?: string;
  timeout: number;
  autoClose: boolean;
  closeDelay: number;
  closeTimeout?: NodeJS.Timeout;
  autoRefresh: boolean;
  refreshInterval: number;
  refreshTimer?: NodeJS.Timeout;
  _gems: any; // From GemMixin
  kwargs: any;

  // Mixin properties
  gems: any;
  fetchGems!: (includeHidden?: boolean) => Promise<any>;
  createGem!: (
    name: string,
    prompt: string,
    description?: string
  ) => Promise<Gem>;
  updateGem!: (
    gem: Gem | string,
    name: string,
    prompt: string,
    description?: string
  ) => Promise<Gem>;
  deleteGem!: (gem: Gem | string, kwargs?: any) => Promise<void>;

  constructor(
    secure1psid?: string,
    secure1psidts?: string,
    proxy?: string,
    kwargs: any = {}
  ) {
    this.cookies = {};
    this.proxy = proxy;
    this._running = false;
    this.timeout = 30000; // ms
    this.autoClose = false;
    this.closeDelay = 300000; // ms
    this.autoRefresh = true;
    this.refreshInterval = 540000; // ms
    this.kwargs = kwargs;

    if (secure1psid) {
      this.cookies["__Secure-1PSID"] = secure1psid;
      if (secure1psidts) {
        this.cookies["__Secure-1PSIDTS"] = secure1psidts;
      }
    }
  }

  async init({
    timeout = 30000,
    autoClose = false,
    closeDelay = 300000,
    autoRefresh = true,
    refreshInterval = 540000,
    verbose = true,
  }: {
    timeout?: number;
    autoClose?: boolean;
    closeDelay?: number;
    autoRefresh?: boolean;
    refreshInterval?: number;
    verbose?: boolean;
  } = {}) {
    try {
      const [accessToken, validCookies] = await getAccessToken(
        this.cookies,
        this.proxy,
        verbose
      );

      const jar = new CookieJar();
      for (const [key, value] of Object.entries(validCookies)) {
        await jar.setCookie(
          `${key}=${value}; Domain=.google.com`,
          "https://google.com"
        );
      }

      const agent = this.proxy ? new HttpsProxyAgent(this.proxy) : undefined;

      this.client = wrapper(
        axios.create({
          timeout: timeout,
          httpsAgent: agent,
          headers: Headers.GEMINI,
          jar: jar,
          maxRedirects: 5,
          validateStatus: () => true,
          ...this.kwargs,
        })
      );

      this.accessToken = accessToken;
      this.cookies = validCookies;
      this._running = true;

      this.timeout = timeout;
      this.autoClose = autoClose;
      this.closeDelay = closeDelay;

      if (this.autoClose) {
        this.resetCloseTask();
      }

      this.autoRefresh = autoRefresh;
      this.refreshInterval = refreshInterval;

      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = undefined;
      }

      if (this.autoRefresh) {
        this.startAutoRefresh();
      }

      if (verbose) {
        logger.success("Gemini client initialized successfully.");
      }
    } catch (e) {
      await this.close();
      throw e;
    }
  }

  async close(delay: number = 0) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this._running = false;

    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }

    if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = undefined;
    }

    this.client = undefined;
  }

  resetCloseTask() {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
    }
    this.closeTimeout = setTimeout(() => this.close(), this.closeDelay);
  }

  startAutoRefresh() {
      // In python this is an asyncio task. In Node we can use setInterval.
      // However, setInterval might drift or stack up if the operation takes long.
      // recursive setTimeout is better.
      const refresh = async () => {
          if (!this._running) return;

          let new1psidts: string | undefined;
          try {
              new1psidts = await rotate1PSIDTS(this.cookies, this.proxy);
          } catch (e) {
               if (e instanceof AuthError) {
                   if (this.refreshTimer) {
                       clearTimeout(this.refreshTimer);
                       this.refreshTimer = undefined;
                   }
                   logger.warning(
                        "AuthError: Failed to refresh cookies. Auto refresh task canceled."
                   );
                   return;
               }
               logger.warning(`Unexpected error while refreshing cookies: ${e}`);
          }

          if (new1psidts) {
              this.cookies["__Secure-1PSIDTS"] = new1psidts;
              if (this._running && this.client && this.client.defaults.jar && (this.client.defaults.jar as any).setCookie) {
                   try {
                     await (this.client.defaults.jar as any).setCookie(
                         `__Secure-1PSIDTS=${new1psidts}; Domain=.google.com`,
                         "https://google.com"
                     );
                   } catch(e) {}
              }
              logger.debug("Cookies refreshed. New __Secure-1PSIDTS applied.");
          }

           this.refreshTimer = setTimeout(refresh, this.refreshInterval);
      };

      this.refreshTimer = setTimeout(refresh, this.refreshInterval);
  }

  async generateContent(
      prompt: string,
      files?: string[],
      model: Model | string | any = Model.UNSPECIFIED,
      gem?: Gem | string | null,
      chat?: ChatSession,
      kwargs: any = {}
  ): Promise<ModelOutput> {
      if (!prompt) {
          throw new Error("Prompt cannot be empty.");
      }

      let modelObj: Model;
      if (typeof model === "string") {
          modelObj = Model.fromName(model);
      } else if (model instanceof Model) {
          modelObj = model;
      } else {
           modelObj = Model.fromDict(model);
      }

      let gemId: string | undefined;
      if (gem) {
          if (typeof gem === "string") {
              gemId = gem;
          } else {
              gemId = gem.id;
          }
      }

      if (this.autoClose) {
          this.resetCloseTask();
      }

      if (!this.client) {
          throw new Error("Client not initialized. Call init() first.");
      }

      // Upload files
      const fileData = [];
      if (files && files.length > 0) {
          for (const file of files) {
              const uploadedUrl = await uploadFile(file, this.proxy);
              fileData.push([
                  [[uploadedUrl], parseFileName(file)]
              ]);
          }
      }

      const reqData = [
          null,
          JSON.stringify([
              (files && files.length > 0)
                ? [prompt, 0, null, fileData]
                : [prompt],
               null,
               chat ? chat.metadata : null,
          ].concat(gemId ? [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, gemId] as any : []))
      ];

      // Note: The python code does `+ (gem_id and [None] * 16 + [gem_id] or [])`.
      // [None] * 16 is 16 nulls.

      let response: AxiosResponse;
      try {
           response = await this.client.post(
              Endpoint.GENERATE,
              new URLSearchParams({
                  "at": this.accessToken!,
                  "f.req": JSON.stringify(reqData)
              }),
              {
                  headers: {
                      ...Headers.GEMINI,
                      ...modelObj.modelHeader
                  },
                  ...kwargs
              }
           );
      } catch (e: any) {
          if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
              throw new TimeoutError(
                "Generate content request timed out, please try again."
            );
          }
          throw e;
      }

      if (response.status !== 200) {
          await this.close();
          throw new APIError(
                `Failed to generate contents. Request failed with status code ${response.status}`
            );
      }

      let responseJson: any[] = [];
      let body: any[] | undefined;
      let bodyIndex = 0;

      try {
          responseJson = extractJsonFromResponse(response.data);

          for (let partIndex = 0; partIndex < responseJson.length; partIndex++) {
              const part = responseJson[partIndex];
              try {
                  const partBody = getNestedValue(part, [2]);
                  if (!partBody) continue;

                  const partJson = JSON.parse(partBody);
                  if (getNestedValue(partJson, [4])) {
                      bodyIndex = partIndex;
                      body = partJson;
                      break;
                  }
              } catch (e) {
                  continue;
              }
          }

          if (!body) throw new Error("No body found");

      } catch (e) {
          await this.close();

           try {
                // Check for errors in responseJson
                const errorCode = getNestedValue(responseJson, [0, 5, 2, 0, 1, 0], -1);
                switch(errorCode) {
                    case ErrorCode.USAGE_LIMIT_EXCEEDED:
                        throw new UsageLimitExceeded(
                            `Failed to generate contents. Usage limit of ${modelObj.modelName} model has exceeded.`
                        );
                    case ErrorCode.MODEL_INCONSISTENT:
                        throw new ModelInvalid(
                            "Failed to generate contents. The specified model is inconsistent with the chat history."
                        );
                    case ErrorCode.MODEL_HEADER_INVALID:
                         throw new ModelInvalid(
                            "Failed to generate contents. The specified model is not available."
                        );
                    case ErrorCode.IP_TEMPORARILY_BLOCKED:
                         throw new TemporarilyBlocked(
                                "Failed to generate contents. Your IP address is temporarily blocked by Google."
                            );
                    default:
                        // Fallthrough
                }

           } catch (err) {
               if (err instanceof GeminiError) throw err;
           }

            logger.debug(`Invalid response: ${response.data}`);
            throw new APIError(
                "Failed to generate contents. Invalid response data received."
            );
      }

      try {
          const candidateList = getNestedValue(body, [4], []);
          const outputCandidates: Candidate[] = [];

          for (let candidateIndex = 0; candidateIndex < candidateList.length; candidateIndex++) {
              const candidate = candidateList[candidateIndex];
              const rcid = getNestedValue(candidate, [0]);
              if (!rcid) continue;

              let text = getNestedValue(candidate, [1, 0], "");
              if (text.match(/^http:\/\/googleusercontent\.com\/card_content\/\d+/)) {
                  text = getNestedValue(candidate, [22, 0]) || text;
              }

              const thoughts = getNestedValue(candidate, [37, 0, 0]);

              // Web images
              const webImages: WebImage[] = [];
              const webImgDataList = getNestedValue(candidate, [12, 1], []);
              for (const webImgData of webImgDataList) {
                  const url = getNestedValue(webImgData, [0, 0, 0]);
                  if (!url) continue;

                  webImages.push({
                      url,
                      title: getNestedValue(webImgData, [7, 0], ""),
                      alt: getNestedValue(webImgData, [0, 4], ""),
                      proxy: this.proxy
                  });
              }

              // Generated images
              const generatedImages: GeneratedImage[] = [];
              if (getNestedValue(candidate, [12, 7, 0])) {
                  let imgBody;
                  for (let imgPartIndex = 0; imgPartIndex < responseJson.length; imgPartIndex++) {
                      if (imgPartIndex < bodyIndex) continue;
                       const part = responseJson[imgPartIndex];
                       try {
                           const imgPartBody = getNestedValue(part, [2]);
                           if (!imgPartBody) continue;
                           const imgPartJson = JSON.parse(imgPartBody);
                           if (getNestedValue(imgPartJson, [4, candidateIndex, 12, 7, 0])) {
                               imgBody = imgPartJson;
                               break;
                           }
                       } catch(e) { continue; }
                  }

                  if (!imgBody) {
                       throw new ImageGenerationError(
                            "Failed to parse generated images."
                        );
                  }

                  const imgCandidate = getNestedValue(imgBody, [4, candidateIndex], []);
                  const finishedText = getNestedValue(imgCandidate, [1, 0]);
                  if (finishedText) {
                       text = finishedText.replace(/http:\/\/googleusercontent\.com\/image_generation_content\/\d+/, "").trim();
                  }

                  const genImgDataList = getNestedValue(imgCandidate, [12, 7, 0], []);
                  for (let imgIndex = 0; imgIndex < genImgDataList.length; imgIndex++) {
                      const genImgData = genImgDataList[imgIndex];
                      const url = getNestedValue(genImgData, [0, 3, 3]);
                      if (!url) continue;

                      const imgNum = getNestedValue(genImgData, [3, 6]);
                      const title = imgNum ? `[Generated Image ${imgNum}]` : "[Generated Image]";

                      const altList = getNestedValue(genImgData, [3, 5], []);
                      const alt = getNestedValue(altList, [imgIndex]) || getNestedValue(altList, [0]) || "";

                      generatedImages.push({
                          url,
                          title,
                          alt,
                          proxy: this.proxy,
                          cookies: this.cookies
                      });
                  }
              }

              outputCandidates.push({
                  rcid,
                  text,
                  thoughts,
                  webImages,
                  generatedImages
              });
          }

          if (outputCandidates.length === 0) {
               throw new GeminiError(
                    "Failed to generate contents. No output data found in response."
                );
          }

          const output: ModelOutput = {
              metadata: getNestedValue(body, [1], []),
              candidates: outputCandidates,
              chosen: 0,
              rcid: outputCandidates[0].rcid,
              text: outputCandidates[0].text,
              images: [...outputCandidates[0].webImages, ...outputCandidates[0].generatedImages]
          };

          if (chat) {
              chat.lastOutputProp = output;
          }

          return output;

      } catch (e: any) {
           logger.debug(`${e.name}: ${e.message}; Invalid response structure: ${response.data}`);
           throw new APIError("Failed to parse response body. Data structure is invalid.");
      }
  }

  startChat(kwargs: any = {}): ChatSession {
      return new ChatSession(this, kwargs);
  }

  async _batchExecute(payloads: RPCData[], kwargs: any = {}): Promise<any> {
      if (!this.client) {
            throw new Error("Client not initialized.");
      }
      try {
           const response = await this.client.post(
               Endpoint.BATCH_EXEC,
               new URLSearchParams({
                   "at": this.accessToken!,
                   "f.req": JSON.stringify([
                       payloads.map(p => p.serialize())
                   ])
               }),
               kwargs
           );

           if (response.status !== 200) {
               await this.close();
               throw new APIError(`Batch execution failed with status code ${response.status}`);
           }

           return response;

      } catch (e: any) {
           if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
              throw new TimeoutError(
                "Batch execute request timed out."
            );
          }
          throw e;
      }
  }
}
applyMixins(GeminiClient, [GemMixin]);

export class ChatSession {
    geminiClient: GeminiClient;
    _metadata: (string | null)[];
    lastOutput?: ModelOutput;
    model: Model | string | any;
    gem?: Gem | string | null;

    constructor(
        geminiClient: GeminiClient,
        {
            metadata,
            cid,
            rid,
            rcid,
            model = Model.UNSPECIFIED,
            gem = null
        }: {
            metadata?: (string | null)[];
            cid?: string;
            rid?: string;
            rcid?: string;
            model?: Model | string | any;
            gem?: Gem | string | null;
        } = {}
    ) {
        this.geminiClient = geminiClient;
        this._metadata = [null, null, null];
        this.model = model;
        this.gem = gem;

        if (metadata) this.metadata = metadata;
        if (cid) this.cid = cid;
        if (rid) this.rid = rid;
        if (rcid) this.rcid = rcid;
    }

    get metadata() {
        return this._metadata;
    }

    set metadata(value: (string | null)[]) {
        if (value.length > 3) throw new Error("metadata cannot exceed 3 elements");
        for(let i=0; i<value.length; i++) {
            this._metadata[i] = value[i];
        }
    }

    get cid() { return this._metadata[0]; }
    set cid(value: string | null) { this._metadata[0] = value; }

    get rid() { return this._metadata[1]; }
    set rid(value: string | null) { this._metadata[1] = value; }

    get rcid() { return this._metadata[2]; }
    set rcid(value: string | null) { this._metadata[2] = value; }

    get lastOutputProp() {
        return this.lastOutput;
    }

    set lastOutputProp(value: ModelOutput | undefined) {
        this.lastOutput = value;
        if (value) {
            this.metadata = value.metadata;
            this.rcid = value.rcid;
        }
    }

    async sendMessage(prompt: string, files?: string[], kwargs: any = {}): Promise<ModelOutput> {
        return await this.geminiClient.generateContent(
            prompt,
            files,
            this.model,
            this.gem,
            this,
            kwargs
        );
    }

    chooseCandidate(index: number): ModelOutput {
        if (!this.lastOutput) {
            throw new Error("No previous output data found in this chat session.");
        }
        if (index >= this.lastOutput.candidates.length) {
             throw new Error(`Index ${index} exceeds the number of candidates in last model output.`);
        }

        this.lastOutput.chosen = index;
        // In python: `self.rcid = self.last_output.rcid` (which actually accesses the *property* rcid of output, which comes from candidate.rcid)
        // Wait, `ModelOutput` in types has `rcid` property.
        // In Python `ModelOutput` implementation (I didn't read it but I assume) has a property `rcid` that returns rcid of chosen candidate.
        // I defined `ModelOutput` interface in TS, but it's just an interface.
        // The `generateContent` returns an object matching that interface, where `rcid` is set to the first candidate's rcid initially.
        // I need to update `rcid` of the `lastOutput` object when choosing candidate, and also the `rcid` of the chat session.

        const candidate = this.lastOutput.candidates[index];
        this.lastOutput.rcid = candidate.rcid;
        this.lastOutput.text = candidate.text;
        // Update images too? Python says `ModelOutput` has `.images` property returning images of default (chosen) reply.
        this.lastOutput.images = [...candidate.webImages, ...candidate.generatedImages];

        this.rcid = this.lastOutput.rcid;

        return this.lastOutput;
    }
}
