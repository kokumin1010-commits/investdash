// キオクシア（285A.T）の株価とプロフィールが取得できるか確認する。
import { fetchQuote } from '../server/services/marketData.ts'

const candidates = ['285A.T', '285A.JP', '285A']

for (const symbol of candidates) {
  try {
    const quote = await fetchQuote(symbol)
    if (!quote) {
      console.log(`${symbol}: null`)
      continue
    }
    console.log(
      `${symbol}: name=${quote.name ?? '-'} price=${quote.price} currency=${quote.currency} ` +
        `sector=${quote.sector ?? '-'} industry=${quote.industry ?? '-'} ` +
        `52w=${quote.fiftyTwoWeekLow ?? '-'}~${quote.fiftyTwoWeekHigh ?? '-'}`,
    )
  } catch (error) {
    console.log(`${symbol}: error ${error instanceof Error ? error.message : String(error)}`)
  }
}
