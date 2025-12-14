import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import fs from "fs-extra";
import path from "path";
import { Endpoint, Headers } from "../constants";
import { AuthError } from "../exceptions";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

export async function rotate1PSIDTS(
  cookies: Record<string, string>,
  proxy?: string
): Promise<string | undefined> {
  const geminiCookiePath =
    process.env.GEMINI_COOKIE_PATH || path.join(__dirname, "../temp");
  await fs.ensureDir(geminiCookiePath);
  const filename = `.cached_1psidts_${cookies["__Secure-1PSID"]}.txt`;
  const cacheFile = path.join(geminiCookiePath, filename);

  if (
    fs.existsSync(cacheFile) &&
    Date.now() - fs.statSync(cacheFile).mtimeMs <= 60000
  ) {
    // Cache was modified in the last minute
    return undefined;
  }

  const jar = new CookieJar();
  for (const [key, value] of Object.entries(cookies)) {
    await jar.setCookie(
      `${key}=${value}; Domain=.google.com`,
      "https://google.com"
    );
  }

  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  const client = wrapper(
    axios.create({
      httpsAgent: agent,
      jar,
    })
  );

  try {
    const response = await client.post(
      Endpoint.ROTATE_COOKIES,
      '[000,"-0000000000000000000"]',
      {
        headers: Headers.ROTATE_COOKIES,
        withCredentials: true,
      }
    );

    const newCookies = await jar.getCookies(Endpoint.ROTATE_COOKIES);
    const new1psidtsCookie = newCookies.find(
      (c) => c.key === "__Secure-1PSIDTS"
    );

    if (new1psidtsCookie) {
      const new1psidts = new1psidtsCookie.value;
      await fs.writeFile(cacheFile, new1psidts);
      return new1psidts;
    }
  } catch (error: any) {
    if (error.response && error.response.status === 401) {
      throw new AuthError();
    }
    throw error;
  }
  return undefined;
}
