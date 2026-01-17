import {expect} from "chai";
import * as sinon from "sinon";

import type {IOnboardingPreferenceStore} from "../../../src/core/interfaces/i-onboarding-preference-store.js";
import type {ITerminal} from "../../../src/core/interfaces/i-terminal.js";
import type {ITokenStore} from "../../../src/core/interfaces/i-token-store.js";
import type {ITrackingService} from "../../../src/core/interfaces/i-tracking-service.js";

import {AuthToken} from "../../../src/core/domain/entities/auth-token.js";
import {LogoutUseCase, LogoutUseCaseDeps} from "../../../src/infra/usecase/logout-use-case.js";
import {createMockTerminal} from "../../helpers/mock-factories.js";

// ==================== TestableLogoutUseCase ====================

interface TestableLogoutUseCaseOptions extends LogoutUseCaseDeps {
  mockConfirmResult?: boolean;
}

class TestableLogoutUseCase extends LogoutUseCase {
  private readonly mockConfirmResult: boolean;

  public constructor(options: TestableLogoutUseCaseOptions) {
    super(options);
    this.mockConfirmResult = options.mockConfirmResult ?? true;
  }

  protected async confirmLogout(_userEmail: string): Promise<boolean> {
    return this.mockConfirmResult;
  }
}

// ==================== Test Helpers ====================

const createMockToken = (): AuthToken =>
  new AuthToken({
    accessToken: "test-access-token",
    expiresAt: new Date(Date.now() + 3600 * 1000),
    refreshToken: "test-refresh-token",
    sessionKey: "test-session-key",
    tokenType: "Bearer",
    userEmail: "test@example.com",
    userId: "user-123",
  });

// ==================== Tests ====================

describe("LogoutUseCase", () => {
  let errorMessages: string[];
  let logMessages: string[];
  let onboardingPreferenceStore: sinon.SinonStubbedInstance<IOnboardingPreferenceStore>;
  let terminal: ITerminal;
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>;
  let trackingService: sinon.SinonStubbedInstance<ITrackingService>;

  beforeEach(() => {
    errorMessages = [];
    logMessages = [];

    terminal = createMockTerminal({
      error: (msg) => errorMessages.push(msg),
      log: (msg) => msg !== undefined && logMessages.push(msg),
    });

    onboardingPreferenceStore = {
      clear: sinon.stub<[], Promise<void>>().resolves(),
      getLastDismissedAt: sinon.stub<[], Promise<number | undefined>>().resolves(),
      setLastDismissedAt: sinon.stub<[number], Promise<void>>().resolves(),
    };

    tokenStore = {
      clear: sinon.stub(),
      load: sinon.stub(),
      save: sinon.stub(),
    };

    trackingService = {
      track: sinon.stub<Parameters<ITrackingService["track"]>, ReturnType<ITrackingService["track"]>>().resolves(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  function createUseCase(mockConfirmResult = true): TestableLogoutUseCase {
    return new TestableLogoutUseCase({
      mockConfirmResult,
      onboardingPreferenceStore,
      terminal,
      tokenStore,
      trackingService,
    });
  }

  describe("Successful logout flow", () => {
    it("should logout successfully when user confirms", async () => {
      const mockToken = createMockToken();
      tokenStore.load.resolves(mockToken);
      tokenStore.clear.resolves();
      trackingService.track.resolves();

      const useCase = createUseCase(true);
      await useCase.run({skipConfirmation: false});

      expect(tokenStore.load.calledOnce).to.be.true;
      expect(trackingService.track.calledOnce).to.be.true;
      expect(trackingService.track.calledWith("auth:signed_out")).to.be.true;
      expect(tokenStore.clear.calledOnce).to.be.true;
      expect(logMessages.some((m) => m.includes("Successfully logged out"))).to.be.true;
    });

    it("should logout successfully with skipConfirmation: true", async () => {
      const mockToken = createMockToken();
      tokenStore.load.resolves(mockToken);
      tokenStore.clear.resolves();
      trackingService.track.resolves();

      const useCase = createUseCase();
      await useCase.run({skipConfirmation: true});

      expect(tokenStore.clear.calledOnce).to.be.true;
      expect(trackingService.track.calledWith("auth:signed_out")).to.be.true;
      expect(logMessages.some((m) => m.includes("Successfully logged out"))).to.be.true;
    });

    it("should display re-login instructions after logout", async () => {
      const mockToken = createMockToken();
      tokenStore.load.resolves(mockToken);
      tokenStore.clear.resolves();

      const useCase = createUseCase();
      await useCase.run({skipConfirmation: true});

      expect(logMessages.some((m) => m.includes("/login"))).to.be.true;
    });
  });

  describe("Not logged in", () => {
    it("should display message when no token exists", async () => {
      tokenStore.load.resolves();

      const useCase = createUseCase();
      await useCase.run({skipConfirmation: false});

      expect(logMessages.some((m) => m.includes("not currently logged in"))).to.be.true;
      expect(tokenStore.clear.called).to.be.false;
      expect(trackingService.track.called).to.be.false;
    });
  });

  describe("User cancels logout", () => {
    it("should not logout when user declines confirmation", async () => {
      const mockToken = createMockToken();
      tokenStore.load.resolves(mockToken);

      const useCase = createUseCase(false);
      await useCase.run({skipConfirmation: false});

      expect(logMessages.some((m) => m.includes("Logout cancelled"))).to.be.true;
      expect(tokenStore.clear.called).to.be.false;
      expect(trackingService.track.called).to.be.false;
    });
  });

  describe("Tracking event order", () => {
    it("should track sign_out event BEFORE clearing token", async () => {
      const mockToken = createMockToken();
      tokenStore.load.resolves(mockToken);
      tokenStore.clear.resolves();

      const useCase = createUseCase();
      await useCase.run({skipConfirmation: true});

      expect(trackingService.track.calledBefore(tokenStore.clear)).to.be.true;
      expect(trackingService.track.calledWith("auth:signed_out")).to.be.true;
    });

    it("should continue logout even if tracking fails", async () => {
      const mockToken = createMockToken();
      tokenStore.load.resolves(mockToken);
      tokenStore.clear.resolves();
      trackingService.track.rejects(new Error("Tracking service unavailable"));

      const useCase = createUseCase();
      await useCase.run({skipConfirmation: true});

      expect(tokenStore.clear.calledOnce).to.be.true;
      expect(logMessages.some((m) => m.includes("Successfully logged out"))).to.be.true;
    });
  });

  describe("Error handling", () => {
    it("should display user-friendly message for keychain access errors", async () => {
      const mockToken = createMockToken();
      tokenStore.load.resolves(mockToken);
      tokenStore.clear.rejects(new Error("Failed to access keychain"));

      const useCase = createUseCase();
      await useCase.run({skipConfirmation: true});

      expect(errorMessages).to.have.lengthOf(1);
      expect(errorMessages[0]).to.include("Unable to access system keychain");
    });

    it("should handle generic errors gracefully", async () => {
      const mockToken = createMockToken();
      tokenStore.load.resolves(mockToken);
      tokenStore.clear.rejects(new Error("Unexpected error"));

      const useCase = createUseCase();
      await useCase.run({skipConfirmation: true});

      expect(errorMessages).to.have.lengthOf(1);
      expect(errorMessages[0]).to.include("Unexpected error");
    });

    it("should handle token load errors", async () => {
      tokenStore.load.rejects(new Error("Failed to load token"));

      const useCase = createUseCase();
      await useCase.run({skipConfirmation: false});

      expect(errorMessages).to.have.lengthOf(1);
      expect(errorMessages[0]).to.include("Failed to load token");
      expect(tokenStore.clear.called).to.be.false;
    });
  });
});
