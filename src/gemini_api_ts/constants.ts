export enum Endpoint {
  GOOGLE = "https://www.google.com",
  INIT = "https://gemini.google.com/app",
  GENERATE = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
  ROTATE_COOKIES = "https://accounts.google.com/RotateCookies",
  UPLOAD = "https://content-push.googleapis.com/upload",
  BATCH_EXEC = "https://gemini.google.com/_/BardChatUi/data/batchexecute",
}

export enum GRPC {
  // Chat methods
  LIST_CHATS = "MaZiqc",
  READ_CHAT = "hNvQHb",

  // Gem methods
  LIST_GEMS = "CNgdBe",
  CREATE_GEM = "oMH3Zd",
  UPDATE_GEM = "kHv0Vd",
  DELETE_GEM = "UXcSJb",
}

export const Headers: Record<string, Record<string, string>> = {
  GEMINI: {
    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    "Host": "gemini.google.com",
    "Origin": "https://gemini.google.com",
    "Referer": "https://gemini.google.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-Same-Domain": "1",
  },
  ROTATE_COOKIES: {
    "Content-Type": "application/json",
  },
  UPLOAD: { "Push-ID": "feeds/mcudyrk2a4khkz" },
};

export class Model {
  modelName: string;
  modelHeader: Record<string, string>;
  advancedOnly: boolean;

  constructor(
    name: string,
    header: Record<string, string>,
    advancedOnly: boolean
  ) {
    this.modelName = name;
    this.modelHeader = header;
    this.advancedOnly = advancedOnly;
  }

  static UNSPECIFIED = new Model("unspecified", {}, false);
  static G_3_0_PRO = new Model(
    "gemini-3.0-pro",
    {
      "x-goog-ext-525001261-jspb":
        '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
    },
    false
  );
  static G_2_5_PRO = new Model(
    "gemini-2.5-pro",
    {
      "x-goog-ext-525001261-jspb":
        '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
    },
    false
  );
  static G_2_5_FLASH = new Model(
    "gemini-2.5-flash",
    {
      "x-goog-ext-525001261-jspb":
        '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
    },
    false
  );

  static fromName(name: string): Model {
    const models = [
      Model.UNSPECIFIED,
      Model.G_3_0_PRO,
      Model.G_2_5_PRO,
      Model.G_2_5_FLASH,
    ];
    for (const model of models) {
      if (model.modelName === name) {
        return model;
      }
    }
    throw new Error(
      `Unknown model name: ${name}. Available models: ${models.map((m) => m.modelName).join(", ")}`
    );
  }

  static fromDict(modelDict: {
    model_name: string;
    model_header: Record<string, string>;
  }): Model {
    if (!modelDict.model_name || !modelDict.model_header) {
      throw new Error(
        "When passing a custom model as a dictionary, 'model_name' and 'model_header' keys must be provided."
      );
    }
    return new Model(modelDict.model_name, modelDict.model_header, false);
  }
}

export enum ErrorCode {
  TEMPORARY_ERROR_1013 = 1013,
  USAGE_LIMIT_EXCEEDED = 1037,
  MODEL_INCONSISTENT = 1050,
  MODEL_HEADER_INVALID = 1052,
  IP_TEMPORARILY_BLOCKED = 1060,
}
