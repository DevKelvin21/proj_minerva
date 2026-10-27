/**
 * The two prompts an agentic provider sends, picked by what was asked: the
 * full didactic analysis (`ai:analyzePullRequest`) or a reviewer's question
 * about some lines (`ai:askAboutLines`, `AnalyzePullRequestOptions.question`).
 * Both answer in the `@@@SECTION` protocol, so the providers' transport,
 * jail, timeouts and parser are the same for either.
 */
import type { AppLocale } from '../../shared/locale'
import type { DiffFile, LineQuestion, PullRequestDetail } from '../../shared/types'
import { buildAgenticUserMessage } from './analysis-prompt'
import { buildAnalyzeSystemPrompt } from './prompts/analyze-pr'
import { buildAskLinesSystemPrompt, buildAskLinesUserMessage } from './prompts/ask-lines'

export interface AgenticPrompts {
  systemPrompt: string
  userMessage: string
}

export function agenticPrompts(
  detail: PullRequestDetail,
  files: DiffFile[],
  language: AppLocale,
  question?: LineQuestion,
): AgenticPrompts {
  if (question) {
    return {
      systemPrompt: buildAskLinesSystemPrompt(language),
      userMessage: buildAskLinesUserMessage(detail, files, question),
    }
  }
  return {
    systemPrompt: buildAnalyzeSystemPrompt(language),
    userMessage: buildAgenticUserMessage(detail, files),
  }
}
