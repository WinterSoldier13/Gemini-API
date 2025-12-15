import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import fs from "fs-extra";
import path from "path";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import { Endpoint, Headers } from "../constants";
import { AuthError } from "../exceptions";
import { logger } from "./logger";

async function sendRequest(
  cookies: Record<string, string>,
  proxy?: string
): Promise<{ response: any; cookies: Record<string, string> }> {
  const jar = new CookieJar();
  for (const [key, value] of Object.entries(cookies)) {
    try {
      await jar.setCookie(
        `${key}=${value}; Domain=.google.com`,
        "https://google.com"
      );
    } catch (e) {
      // Ignore invalid cookies
    }
  }

  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  const client = wrapper(
    axios.create({
      httpsAgent: agent,
      jar,
      headers: Headers.GEMINI,
      maxRedirects: 5,
      validateStatus: () => true, // Don't throw on status codes
    })
  );

  const response = await client.get(Endpoint.INIT);
  if (response.status >= 400) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const responseCookies = await jar.getCookies(Endpoint.INIT);
  const cookieDict: Record<string, string> = { ...cookies };
  for (const cookie of responseCookies) {
    cookieDict[cookie.key] = cookie.value;
  }

  return { response, cookies: cookieDict };
}

export async function getAccessToken(
  baseCookies: Record<string, string>,
  proxy?: string,
  verbose: boolean = false
): Promise<[string, Record<string, string>]> {
  // Try to visit google.com first to get extra cookies
  let extraCookies: Record<string, string> = {};
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      httpsAgent: agent,
      jar,
      maxRedirects: 5,
      validateStatus: () => true,
    })
  );

  try {
    const response = await client.get(Endpoint.GOOGLE);
    if (response.status === 200) {
      const cookies = await jar.getCookies(Endpoint.GOOGLE);
      for (const cookie of cookies) {
        extraCookies[cookie.key] = cookie.value;
      }
    }
  } catch (e) {
    // Ignore
  }

  const tasks: (() => Promise<{
    response: any;
    cookies: Record<string, string>;
  }>)[] = [];

  // Base cookies
  if (baseCookies["__Secure-1PSID"] && baseCookies["__Secure-1PSIDTS"]) {
    tasks.push(() =>
      sendRequest({ ...extraCookies, ...baseCookies }, proxy)
    );
  } else if (verbose) {
    logger.debug(
      "Skipping loading base cookies. Either __Secure-1PSID or __Secure-1PSIDTS is not provided."
    );
  }

  // Cached cookies
  const geminiCookiePath =
    process.env.GEMINI_COOKIE_PATH || path.join(__dirname, "../temp");

  // ensure dir exists
  await fs.ensureDir(geminiCookiePath);

  if (baseCookies["__Secure-1PSID"]) {
    const filename = `.cached_1psidts_${baseCookies["__Secure-1PSID"]}.txt`;
    const cacheFile = path.join(geminiCookiePath, filename);
    if (fs.existsSync(cacheFile)) {
      const cached1psidts = fs.readFileSync(cacheFile, "utf-8");
      if (cached1psidts) {
        const cachedCookies = {
          ...extraCookies,
          ...baseCookies,
          "__Secure-1PSIDTS": cached1psidts,
        };
        tasks.push(() => sendRequest(cachedCookies, proxy));
      } else if (verbose) {
        logger.debug("Skipping loading cached cookies. Cache file is empty.");
      }
    } else if (verbose) {
      logger.debug("Skipping loading cached cookies. Cache file not found.");
    }
  } else {
      // If 1PSID is not provided, we can't look up specific cache.
      // Python version iterates over all cache files.
      // But we probably need 1PSID anyway to identify the user.
      // For now I'll implement similar logic.
      const files = await fs.readdir(geminiCookiePath);
      let validCaches = 0;
      for (const file of files) {
          if (file.startsWith(".cached_1psidts_") && file.endsWith(".txt")) {
               const psid = file.substring(16, file.length - 4);
               const cached1psidts = fs.readFileSync(path.join(geminiCookiePath, file), "utf-8");
               if (cached1psidts) {
                   const cachedCookies = {
                       ...extraCookies,
                       "__Secure-1PSID": psid,
                       "__Secure-1PSIDTS": cached1psidts
                   }
                   tasks.push(() => sendRequest(cachedCookies, proxy));
                   validCaches++;
               }
          }
      }
       if (validCaches === 0 && verbose) {
            logger.debug(
                "Skipping loading cached cookies. Cookies will be cached after successful initialization."
            )
       }
  }

  // Browser cookies - SKIPPED as it requires native modules or platform specific logic not easily available in pure node/ts
  if (verbose) {
       logger.debug(
                "Skipping loading local browser cookies. Feature not supported in TS version yet."
            )
  }

  if (tasks.length === 0) {
    throw new AuthError(
      "No valid cookies available for initialization. Please pass __Secure-1PSID and __Secure-1PSIDTS manually."
    );
  }

  for (let i = 0; i < tasks.length; i++) {
      try {
          const { response, cookies } = await tasks[i]();
          const match = response.data.match(/"SNlM0e":"(.*?)"/);
          if (match && match[1]) {
               if (verbose) {
                    logger.debug(
                        `Init attempt (${i + 1}/${tasks.length}) succeeded. Initializing client...`
                    )
               }
               return [match[1], cookies];
          } else if (verbose) {
              logger.debug(
                    `Init attempt (${i + 1}/${tasks.length}) failed. Cookies invalid.`
                )
          }
      } catch (e: any) {
           if (verbose) {
                logger.debug(
                    `Init attempt (${i + 1}/${tasks.length}) failed with error: ${e.message}`
                )
            }
      }
  }

  throw new AuthError(
    "Failed to initialize client. SECURE_1PSIDTS could get expired frequently, please make sure cookie values are up to date. " +
    `(Failed initialization attempts: ${tasks.length})`
  );
}
