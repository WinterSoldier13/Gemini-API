import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import FormData from "form-data";
import fs from "fs-extra";
import path from "path";
import { Endpoint, Headers } from "../constants";

export async function uploadFile(
  filePath: string,
  proxy?: string
): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append("file", fileBuffer, {
    filename: path.basename(filePath),
  });

  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

  const response = await axios.post(Endpoint.UPLOAD, form, {
    headers: {
      ...Headers.UPLOAD,
      ...form.getHeaders(),
    },
    httpsAgent: agent,
    maxRedirects: 5,
  });

  if (response.status >= 400) {
    throw new Error(`Upload failed with status ${response.status}`);
  }

  return response.data;
}

export function parseFileName(filePath: string): string {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${filePath} is not a valid file.`);
  }
  return path.basename(filePath);
}
