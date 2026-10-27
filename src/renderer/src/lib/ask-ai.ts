/**
 * The text of a follow-up question: each `ai:askAboutLines` run starts fresh
 * in main, so a follow-up quotes the previous exchange. The whole text must
 * fit `max` characters (main rejects longer), and the NEW question is never
 * cut: the quoted question gets up to a quarter of what is left, the quoted
 * answer the rest, each shortened with "…".
 *
 * `format` builds the translated text from its three parts.
 */
export function followUpQuestion(
  format: (question: string, answer: string, followUp: string) => string,
  previous: { question: string; answer: string },
  followUp: string,
  max: number,
): string {
  const bare = format('', '', followUp)
  if (bare.length >= max) return followUp.slice(0, max)
  let room = max - bare.length
  const question = clip(previous.question, Math.min(previous.question.length, Math.floor(room / 4)))
  room -= question.length
  const answer = clip(previous.answer, room)
  return format(question, answer, followUp)
}

function clip(text: string, length: number): string {
  if (text.length <= length) return text
  if (length <= 1) return ''
  return text.slice(0, length - 1) + '…'
}
