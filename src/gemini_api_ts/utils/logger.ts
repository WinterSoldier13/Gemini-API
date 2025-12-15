export const logger = {
  debug: (message: string) => console.debug(`[DEBUG] ${message}`),
  info: (message: string) => console.info(`[INFO] ${message}`),
  warning: (message: string) => console.warn(`[WARNING] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  success: (message: string) => console.log(`[SUCCESS] ${message}`),
};
