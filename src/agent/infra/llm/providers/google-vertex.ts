/**
 * Google Vertex AI Provider Module
 *
 * Access Gemini models via Google Cloud Vertex AI using @ai-sdk/google-vertex.
 * Uses service account authentication (Application Default Credentials).
 *
 * Required env vars:
 * - GOOGLE_CLOUD_PROJECT (or GCP_PROJECT, GCLOUD_PROJECT)
 * - GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)
 *
 * Optional env vars:
 * - GOOGLE_CLOUD_LOCATION (defaults to us-central1)
 */

import {createVertex} from '@ai-sdk/google-vertex'

import type {GeneratorFactoryConfig, ProviderModule} from './types.js'

import {AiSdkContentGenerator} from '../generators/ai-sdk-content-generator.js'

export const googleVertexProvider: ProviderModule = {
  apiKeyUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  authType: 'service-account',
  category: 'popular',
  createGenerator(config: GeneratorFactoryConfig) {
    const provider = createVertex({
      location: config.location ?? 'us-central1',
      project: config.project!,
    })

    return new AiSdkContentGenerator({
      model: provider(config.model),
    })
  },
  defaultModel: 'gemini-2.5-flash',
  description: 'Gemini models via Google Cloud Vertex AI',
  envVars: ['GOOGLE_APPLICATION_CREDENTIALS'],
  id: 'google-vertex',
  name: 'Google Vertex AI',
  priority: 5,

  providerType: 'gemini',
}
