import type {ITerminal} from "../../core/interfaces/i-terminal.js";
import type {ITokenStore} from "../../core/interfaces/i-token-store.js";
import type {ITrackingService} from "../../core/interfaces/i-tracking-service.js";
import type {ILogoutUseCase} from "../../core/interfaces/usecase/i-logout-use-case.js";

export interface LogoutUseCaseDeps {
  terminal: ITerminal;
  tokenStore: ITokenStore;
  trackingService: ITrackingService;
}

export class LogoutUseCase implements ILogoutUseCase {
  private readonly terminal: ITerminal;
  private readonly tokenStore: ITokenStore;
  private readonly trackingService: ITrackingService;

  public constructor(deps: LogoutUseCaseDeps) {
    this.terminal = deps.terminal;
    this.tokenStore = deps.tokenStore;
    this.trackingService = deps.trackingService;
  }

  protected async confirmLogout(userEmail: string): Promise<boolean> {
    return this.terminal.confirm({
      default: true,
      message: `Logging out ${userEmail}. Are you sure?`,
    });
  }

  public async run(options: {skipConfirmation: boolean}): Promise<void> {
    try {
      const token = await this.tokenStore.load();
      if (token === undefined) {
        this.terminal.log("You are not currently logged in.");
        return;
      }

      if (!options.skipConfirmation) {
        const confirmed = await this.confirmLogout(token.userEmail);
        if (!confirmed) {
          this.terminal.log("Logout cancelled");
          return;
        }
      }

      try {
        await this.trackingService.track("auth:signed_out");
      } catch {
        // Tracking failures should not block logout
      }

      await this.tokenStore.clear();
      this.terminal.log("Successfully logged out.");
      this.terminal.log("Run 'brv login' to authenticate again.");
    } catch (error) {
      if (error instanceof Error && error.message.includes("keychain")) {
        this.terminal.error("Unable to access system keychain. Please check your system permissions and try again.");
        return;
      }

      this.terminal.error(error instanceof Error ? error.message : "Logout failed");
    }
  }
}
