/**
 * The two prompts an agentic provider sends, picked by what was asked: the
 * full didactic analysis (`ai:analyzePullRequest`) or a reviewer's chat
 * message (`chat:send`, `AnalyzePullRequestOptions.chat`). Both answer in the
 * `@@@SECTION` protocol, so the providers' transport, jail, timeouts and
 * parser are the same for either.
 */
import type { AppLocale } from '../../shared/locale'
import type { DiffFile, PullRequestDetail } from '../../shared/types'
import { buildAgenticUserMessage } from './analysis-prompt'
import { buildAnalyzeSystemPrompt } from './prompts/analyze-pr'
import { buildAskChatSystemPrompt, buildAskChatUserMessage } from './prompts/ask-chat'
import type { ChatTurnInput } from './service'

export interface AgenticPrompts {
  systemPrompt: string
  userMessage: string
}

export function agenticPrompts(
  detail: PullRequestDetail,
  files: DiffFile[],
  language: AppLocale,
  chat?: ChatTurnInput,
): AgenticPrompts {
  if (chat) {
    return {
      systemPrompt: buildAskChatSystemPrompt(language),
      userMessage: buildAskChatUserMessage(detail, files, chat),
    }
  }
  return {
    systemPrompt: buildAnalyzeSystemPrompt(language),
    userMessage: buildAgenticUserMessage(detail, files),
  }
}
