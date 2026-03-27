import { createLogger, format, transports, Logger } from "winston";

const logger: Logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.printf(
      (info: any) =>
        `${info.timestamp ?? ""} [${info.level ?? ""}]: ${info.message ?? ""}`
    )
  ),
  transports: [new transports.Console()],
});

export const logInfo = (message: string) => logger.info(message);
export const logError = (message: string) => logger.error(message);
export const logWarning = (message: string) => logger.warn(message);

export default logger;
