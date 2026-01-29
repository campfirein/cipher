import {expect} from 'chai';

import type {ITemplateLoader} from "../../../../../src/server/core/interfaces/services/i-template-loader.js";

import {BRV_RULE_MARKERS, BRV_RULE_TAG} from "../../../../../src/server/infra/connectors/shared/constants.js";
import {RuleTemplateService} from "../../../../../src/server/infra/connectors/shared/template-service.js";

class MockTemplateLoader implements ITemplateLoader {
  public async loadSection(sectionName: string): Promise<string> {
    return `Mock ${sectionName} content`;
  }

  public async loadTemplate(): Promise<string> {
    return `{{workflow}}\n---\n{{command_reference}}`;
  }

  public substituteVariables(template: string, context: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }

    return result;
  }
}

describe('RuleTemplateService', () => {
  let ruleTemplateService: RuleTemplateService;
  let mockTemplateLoader: ITemplateLoader;

  beforeEach(() => {
    mockTemplateLoader = new MockTemplateLoader();
    ruleTemplateService = new RuleTemplateService(mockTemplateLoader);
  });

  describe('generateRuleContent', () => {
    describe('Windsurf frontmatter placement', () => {
      it('should place frontmatter BEFORE markers for Windsurf\'s rules', async () => {
        const result = await ruleTemplateService.generateRuleContent('Windsurf', 'rules');
        const lines = result.split('\n');

        // First lines should be the start of frontmatter
        expect(lines[0]).to.equal('---');
        expect(lines[1]).to.equal('trigger: always_on');
        expect(lines[2]).to.equal('---');

        // Markers should come after frontmatter
        expect(lines[3]).to.equal(BRV_RULE_MARKERS.START);

        // Content should be inside markers
        expect(lines[4]).to.equal('Mock workflow content');
        expect(lines[5]).to.equal('---');
        expect(lines[6]).to.equal('Mock command-reference content');
        expect(lines[7]).to.equal('---');
        expect(lines[8]).to.equal(`${BRV_RULE_TAG} Windsurf`);
        expect(lines[9]).to.equal(BRV_RULE_MARKERS.END);
      })
    });

    describe('Other agents with frontmatter', () => {
      it('should place front matter INSIDE markers for Cursor\'s rules', async () => {
        const result = await ruleTemplateService.generateRuleContent('Cursor', 'rules');
        const lines = result.split('\n');

        // First lines should be the START marker
        expect(lines[0]).to.equal(BRV_RULE_MARKERS.START);

        // Frontmatter should come after marker
        expect(lines[1]).to.equal('---');
        expect(lines[2]).to.equal('description: ByteRover CLI Rules');
        expect(lines[3]).to.equal('alwaysApply: true');
        expect(lines[4]).to.equal('---');
      });

      it('should place frontmatter INSIDE markers for Augment Code\'s rules', async () => {
        const result = await ruleTemplateService.generateRuleContent('Augment Code', 'rules');
        const lines = result.split('\n');

        // First line should be the START marker
        expect(lines[0]).to.equal(BRV_RULE_MARKERS.START);

        // Frontmatter should come after marker
        expect(lines[1]).to.equal('---');
        expect(lines[2]).to.equal('type: "always_apply"');
        expect(lines[3]).to.equal('---');
      });
    });

    describe('agents without frontmatter', () => {
      it('should start with marker for Claude Code', async () => {
        const result = await ruleTemplateService.generateRuleContent('Claude Code', 'rules');
        const lines = result.split('\n');

        expect(lines[0]).to.equal(BRV_RULE_MARKERS.START);
        expect(lines[1]).to.equal('');
        expect(lines[2]).to.equal('Mock workflow content');
      })
    })
  });
});