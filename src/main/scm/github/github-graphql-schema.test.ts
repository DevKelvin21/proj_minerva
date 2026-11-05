import { validate } from '@octokit/graphql-schema'
import { describe, expect, it } from 'vitest'
import { MERGE_OPTIONS_QUERY } from './merge-options'
import { GITHUB_GRAPHQL_DOCUMENTS } from './real-service'

/**
 * Checks every GraphQL document against GitHub's published schema. Unit tests
 * feed fixtures, so a field GitHub does not have (e.g. `originalCommit` on
 * `PullRequestReviewThread`) passed them and failed every real request.
 */
describe('GitHub GraphQL documents', () => {
  const documents = { ...GITHUB_GRAPHQL_DOCUMENTS, MERGE_OPTIONS_QUERY }

  it.each(Object.entries(documents))('%s validates against the GitHub schema', (_, document) => {
    expect(validate(document).map((error) => error.message)).toEqual([])
  })
})
