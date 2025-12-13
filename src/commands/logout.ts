import {Command, Flags} from "@oclif/core";

import type {ILogoutUseCase} from "../core/interfaces/usecase/i-logout-use-case.js";

import {KeychainTokenStore} from "../infra/storage/keychain-token-store.js";
import {OclifTerminal} from "../infra/terminal/oclif-terminal.js";
import {MixpanelTrackingService} from "../infra/tracking/mixpanel-tracking-service.js";
import {LogoutUseCase} from "../infra/usecase/logout-use-case.js";

export default class Logout extends Command {
  public static description = "Log out of ByteRover CLI and clear authentication (does not affect local project files)";
  public static examples = ["<%= config.bin %> <%= command.id %>", "<%= config.bin %> <%= command.id %> --yes"];
  public static flags = {
    yes: Flags.boolean({
      char: "y",
      default: false,
      description: "Skip confirmation prompt",
    }),
  };

  protected createUseCase(): ILogoutUseCase {
    const tokenStore = new KeychainTokenStore();
    return new LogoutUseCase({
      terminal: new OclifTerminal(this),
      tokenStore,
      trackingService: new MixpanelTrackingService(tokenStore),
    });
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Logout);
    await this.createUseCase().run({skipConfirmation: flags.yes});
  }
}
