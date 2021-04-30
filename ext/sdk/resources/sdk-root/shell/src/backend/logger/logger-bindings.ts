import { interfaces } from "inversify";
import { bindContributionProvider } from "backend/contribution-provider";
import { ConsoleLogger } from "./console-logger";
import { bindLogProvider, LogProvider } from "./log-provider";
import { LogService } from "./log-service";
import { SentryLogger } from "./sentry-logger";

export const bindLogger = (container: interfaces.Container) => {
  container.bind(LogService).toSelf().inSingletonScope();

  bindContributionProvider(container, LogProvider);

  container.bind(ConsoleLogger).toSelf().inSingletonScope();
  bindLogProvider(container, ConsoleLogger);

  container.bind(SentryLogger).toSelf().inSingletonScope();
  bindLogProvider(container, SentryLogger);
};
