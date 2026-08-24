import type { Language } from './types';

/**
 * Mini-app copy in English and Amharic. The super app shows a language
 * switcher, so every customer-facing string routes through `t()`.
 */

export const LANGUAGES: { value: Language; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'En' },
  { value: 'am', label: 'አማርኛ', short: 'አማ' },
];

const dictionary = {
  'app.name': { en: 'GuessLow', am: 'GuessLow' },
  'app.tagline': { en: 'Bid Low! Win Big!', am: 'ዝቅ ብለው ይጫረቱ! ትልቅ ያሸንፉ!' },
  'app.platform': { en: 'GuessLow Auction Platform', am: 'የGuessLow ጨረታ መድረክ' },

  'nav.home': { en: 'Home', am: 'መነሻ' },
  'nav.auctions': { en: 'Auctions', am: 'ጨረታዎች' },
  'nav.myBids': { en: 'My Bids', am: 'የእኔ ጨረታዎች' },
  'nav.wins': { en: 'My Wins', am: 'ያሸነፍኩት' },
  'nav.profile': { en: 'Profile', am: 'መገለጫ' },

  'home.startBidding': { en: 'START BIDDING NOW', am: 'አሁን ጨረታ ይጀምሩ' },
  'home.categories': { en: 'Categories', am: 'ምድቦች' },
  'home.featured': { en: 'Featured Items', am: 'ተመራጭ ዕቃዎች' },
  'home.featuredSub': {
    en: 'Bid and win great deals. Our auction process is simple, efficient, and transparent.',
    am: 'ተጫርተው ያሸንፉ። የጨረታ ሂደታችን ቀላል፣ ቀልጣፋ እና ግልጽ ነው።',
  },
  'home.endingSoon': { en: 'Ending Soon Auctions', am: 'በቅርቡ የሚያልቁ ጨረታዎች' },
  'home.endingSoonSub': {
    en: "Don't miss out! These auctions are ending soon. Place your bid now!",
    am: 'እድሉን አያምልጥዎት! እነዚህ ጨረታዎች በቅርቡ ያልቃሉ። አሁን ይጫረቱ!',
  },
  'home.allWinners': { en: 'All winners', am: 'ሁሉም አሸናፊዎች' },
  'home.howItWorks': { en: 'How It Works', am: 'እንዴት እንደሚሰራ' },
  'home.description': {
    en: 'GUESSLOW is a Lowest Unique Bid Auction where the participant who submits the lowest unique bid wins. For instance, if ETB 1.00 is submitted twice, ETB 2.00 once, ETB 3.00 twice, and ETB 4.00 once, the lowest unique bid is ETB 2.00, so it wins. However, it is important to note that the lowest bid does not always win; only the lowest and unique bid wins. Bidders can submit different amounts up to 100 times for a single auction. Win premium items at a fraction of their actual price.',
    am: 'GUESSLOW ዝቅተኛውን ልዩ ጨረታ ያቀረበ ተሳታፊ የሚያሸንፍበት የጨረታ መድረክ ነው። ለምሳሌ፣ ብር 1.00 ሁለት ጊዜ፣ ብር 2.00 አንድ ጊዜ፣ ብር 3.00 ሁለት ጊዜ እና ብር 4.00 አንድ ጊዜ ከቀረበ፣ ዝቅተኛው ልዩ ጨረታ ብር 2.00 ስለሆነ ያሸንፋል። ነገር ግን ዝቅተኛው ጨረታ ሁልጊዜ አያሸንፍም፤ የሚያሸንፈው ዝቅተኛ እና ልዩ የሆነው ጨረታ ብቻ ነው። ተጫራቾች ለአንድ ጨረታ እስከ 100 ጊዜ የተለያዩ መጠኖችን ማቅረብ ይችላሉ። ውድ ዕቃዎችን በዝቅተኛ ዋጋ ያሸንፉ።',
  },

  'auction.bidFee': { en: 'Bid Service Fee', am: 'የጨረታ አገልግሎት ክፍያ' },
  'auction.code': { en: 'Auction Code', am: 'የጨረታ ኮድ' },
  'auction.bids': { en: 'bids', am: 'ጨረታዎች' },
  'auction.bidAmount': { en: 'Bid amount', am: 'የጨረታ መጠን' },
  'auction.submitBid': { en: 'Submit a Bid Amount', am: 'የጨረታ መጠን ያስገቡ' },
  'auction.terms': { en: 'TERMS AND CONDITIONS WILL APPLY', am: 'የአጠቃቀም ውሎች ተፈጻሚ ይሆናሉ' },
  'auction.live': { en: 'Live', am: 'በቀጥታ' },
  'auction.ended': { en: 'Ended', am: 'አልቋል' },
  'auction.scheduled': { en: 'Starting soon', am: 'በቅርቡ ይጀምራል' },
  'auction.retailPrice': { en: 'Actual price', am: 'ትክክለኛ ዋጋ' },
  'auction.range': { en: 'Bid range', am: 'የጨረታ ክልል' },
  'auction.yourBids': { en: 'Your bids', am: 'የእርስዎ ጨረታዎች' },
  'auction.bidsLeft': { en: 'bids left', am: 'የቀሩ ጨረታዎች' },
  'auction.noBidsYet': { en: 'You have not bid on this auction yet.', am: 'እስካሁን በዚህ ጨረታ አልተጫረቱም።' },
  'auction.viewDetails': { en: 'View details', am: 'ዝርዝር ይመልከቱ' },
  'auction.winner': { en: 'Winner', am: 'አሸናፊ' },
  'auction.winningBid': { en: 'Winning bid', am: 'አሸናፊ ጨረታ' },
  'auction.noWinner': { en: 'No unique bid — no winner', am: 'ልዩ ጨረታ የለም — አሸናፊ የለም' },

  'bid.confirming': { en: 'Confirming your payment…', am: 'ክፍያዎ በመረጋገጥ ላይ…' },
  'bid.confirmed': { en: 'Bid confirmed', am: 'ጨረታ ተረጋግጧል' },
  'bid.pending': { en: 'Awaiting payment', am: 'ክፍያ በመጠበቅ ላይ' },
  'bid.failed': { en: 'Payment failed', am: 'ክፍያ አልተሳካም' },
  'bid.void': { en: 'Cancelled', am: 'ተሰርዟል' },
  'bid.unique': { en: 'Unique', am: 'ልዩ' },
  'bid.taken': { en: 'Taken', am: 'ተይዟል' },
  'bid.hiddenUntilEnd': {
    en: 'Bid status is revealed when the auction ends.',
    am: 'የጨረታ ሁኔታ ጨረታው ሲያልቅ ይገለጻል።',
  },
  'bid.registered': { en: 'Registered bid', am: 'የተመዘገበ ጨረታ' },
  'bid.feeNotice': {
    en: 'A service fee of {fee} is charged for each bid, paid from your wallet.',
    am: 'ለእያንዳንዱ ጨረታ {fee} የአገልግሎት ክፍያ ከኪስ ቦርሳዎ ይከፈላል።',
  },
  'bid.freeNotice': {
    en: 'This bid is covered by one you already paid for — no new fee is charged.',
    am: 'ይህ ጨረታ ቀደም ብለው በከፈሉት ተሸፍኗል — አዲስ ክፍያ አይጠየቅም።',
  },

  'ledger.open': { en: 'See how this was decided', am: 'ውሳኔው እንዴት እንደተሰጠ ይመልከቱ' },
  'ledger.title': { en: 'Bid history', am: 'የጨረታ ታሪክ' },
  'ledger.totalBids': { en: 'Total bids', am: 'ጠቅላላ ጨረታዎች' },
  'ledger.cancelled': { en: 'Cancelled out', am: 'የተሰረዙ' },
  'ledger.stoodAlone': { en: 'Stood alone', am: 'ብቻቸውን የቆሙ' },
  'ledger.amounts': { en: 'Amounts bid', am: 'የተጫረቱ መጠኖች' },
  'ledger.whyWon': { en: 'Why it won', am: 'ለምን እንዳሸነፈ' },
  'ledger.allAmounts': { en: 'All amounts', am: 'ሁሉም መጠኖች' },
  'ledger.myAmounts': { en: 'My amounts', am: 'የእኔ መጠኖች' },
  'ledger.checkAmount': { en: 'Check an amount', am: 'መጠን ይፈትሹ' },
  'ledger.taken': { en: 'Taken', am: 'ተይዟል' },
  'ledger.unique': { en: 'Stood alone', am: 'ብቻውን ቆሟል' },
  'ledger.winnerRow': { en: 'Winning bid', am: 'አሸናፊ ጨረታ' },
  'ledger.yourBid': { en: 'Your bid', am: 'የእርስዎ ጨረታ' },
  'ledger.youWon': { en: 'You', am: 'እርስዎ' },
  'ledger.bidsAt': { en: '{count} bids', am: '{count} ጨረታዎች' },
  'ledger.oneBid': { en: '1 bid', am: '1 ጨረታ' },
  'ledger.seeAll': { en: '+{count} more', am: '+{count} ተጨማሪ' },
  'ledger.loadMore': { en: 'Load more amounts', am: 'ተጨማሪ መጠኖች ይጫኑ' },
  'ledger.noMatch': { en: 'Nobody bid that amount.', am: 'ማንም ያንን መጠን አልተጫረተም።' },
  'ledger.notPublished': {
    en: 'The bid history for this auction has not been published.',
    am: 'የዚህ ጨረታ ታሪክ እስካሁን አልታተመም።',
  },
  'ledger.proof': {
    en: 'Every one of the {matched} amounts below {winning} was bid by more than one person, so they all cancelled out. {winning} was bid exactly once.',
    am: 'ከ{winning} በታች ካሉት {matched} መጠኖች እያንዳንዱ ከአንድ በላይ ሰው ተጫርቶበታል፣ ስለዚህ ሁሉም ተሰርዘዋል። {winning} በትክክል አንድ ጊዜ ብቻ ተጫርቷል።',
  },
  'ledger.proofLowest': {
    en: '{winning} was the lowest amount anyone bid, and exactly one person bid it — so it won outright.',
    am: '{winning} ማንም ከተጫረተባቸው ሁሉ ዝቅተኛው መጠን ነበር፣ እናም በትክክል አንድ ሰው ብቻ ተጫረተበት — ስለዚህ በቀጥታ አሸነፈ።',
  },
  'ledger.proofNoWinner': {
    en: 'Every amount bid on this auction was chosen by more than one person, so nothing stood alone and there is no winner.',
    am: 'በዚህ ጨረታ የተጫረተ እያንዳንዱ መጠን ከአንድ በላይ ሰው መርጦታል፣ ስለዚህ ብቻውን የቆመ የለም እና አሸናፊ የለም።',
  },
  'ledger.explainer': {
    en: 'Bids are sealed while an auction runs and opened together when it closes. This is the full record of what everyone bid.',
    am: 'ጨረታዎች ጨረታው በሚካሄድበት ጊዜ ታሽገው ይቆያሉ፤ ሲዘጋም በአንድ ላይ ይከፈታሉ። ይህ ሁሉም ሰው የተጫረተበት ሙሉ መዝገብ ነው።',
  },

  'terms.title': { en: 'Terms and Conditions', am: 'የአጠቃቀም ውሎች' },
  'terms.confirmTitle': { en: 'Confirm your bid', am: 'ጨረታዎን ያረጋግጡ' },
  'terms.confirmIntro': {
    en: 'Accept the terms and conditions to register this bid.',
    am: 'ይህ ጨረታ እንዲመዘገብ የአጠቃቀም ውሎችን ይቀበሉ።',
  },
  'terms.yourBid': { en: 'Your bid amount', am: 'የጨረታ መጠንዎ' },
  'terms.item': { en: 'Your bid item', am: 'የሚጫረቱበት ዕቃ' },
  'terms.nonRefundable': { en: 'Non-refundable', am: 'ተመላሽ የማይደረግ' },
  'terms.feeCovered': { en: 'Already paid', am: 'ቀድሞ ተከፍሏል' },
  'terms.feeExplainer': {
    en: 'The bid service fee is non-refundable and is paid from your wallet to participate in the auction. The amount you submit as a bid is not charged at the time of placing the bid. In this auction, winners are determined based on the lowest unique bid submitted among all participants. Only participants who win the auction are required to pay the amount of their winning bid, in addition to the service fee.',
    am: 'የጨረታ አገልግሎት ክፍያው ተመላሽ የማይደረግ ሲሆን በጨረታው ለመሳተፍ ከኪስ ቦርሳዎ ይከፈላል። እንደ ጨረታ የሚያስገቡት መጠን ጨረታውን በሚያስገቡበት ጊዜ አይከፈልም። በዚህ ጨረታ አሸናፊዎች የሚወሰኑት ከሁሉም ተሳታፊዎች መካከል በቀረበው ዝቅተኛ ልዩ ጨረታ መሠረት ነው። ከአገልግሎት ክፍያው በተጨማሪ ያሸነፉበትን የጨረታ መጠን መክፈል የሚጠበቅባቸው ያሸነፉ ተሳታፊዎች ብቻ ናቸው።',
  },
  'terms.read': { en: 'Read', am: 'ያንብቡ' },
  'terms.hide': { en: 'Hide', am: 'ደብቅ' },
  'terms.accept': {
    en: 'I have read and accept the Terms and Conditions.',
    am: 'የአጠቃቀም ውሎችን አንብቤ ተስማምቻለሁ።',
  },
  'terms.acceptRequired': {
    en: 'Your bid is registered only after you accept the terms and conditions.',
    am: 'ጨረታዎ የሚመዘገበው የአጠቃቀም ውሎችን ከተቀበሉ በኋላ ብቻ ነው።',
  },
  'terms.confirmCta': { en: 'Accept & place bid', am: 'ተስማምቼ ጨረታ አስገባ' },
  'terms.unavailable': {
    en: 'The platform terms and conditions apply to every bid you place. The full text is available on your profile page.',
    am: 'የመድረኩ የአጠቃቀም ውሎች በሚያስገቡት እያንዳንዱ ጨረታ ላይ ተፈጻሚ ይሆናሉ። ሙሉ ጽሑፉ በመገለጫ ገጽዎ ላይ ይገኛል።',
  },

  'wins.title': { en: 'My Wins', am: 'ያሸነፍኳቸው' },
  'wins.empty': { en: 'No wins yet — keep bidding!', am: 'እስካሁን ያሸነፉት የለም — መጫረትዎን ይቀጥሉ!' },
  'wins.claim': { en: 'Claim prize', am: 'ሽልማት ይጠይቁ' },
  'wins.claimed': { en: 'Claim submitted', am: 'ጥያቄ ቀርቧል' },
  'wins.claimDeadline': { en: 'Claim before', am: 'ከዚህ በፊት ይጠይቁ' },

  'ads.sponsored': { en: 'Sponsored', am: 'የተደገፈ' },
  'ads.closesIn': { en: 'You can close this in', am: 'ይህን መዝጋት የሚችሉት በ' },

  'common.loading': { en: 'Loading…', am: 'በመጫን ላይ…' },
  'common.retry': { en: 'Try again', am: 'እንደገና ይሞክሩ' },
  'common.cancel': { en: 'Cancel', am: 'ሰርዝ' },
  'common.confirm': { en: 'Confirm', am: 'አረጋግጥ' },
  'common.close': { en: 'Close', am: 'ዝጋ' },
  'common.search': { en: 'Search', am: 'ፈልግ' },
  'common.all': { en: 'All', am: 'ሁሉም' },
  'common.empty': { en: 'Nothing to show yet.', am: 'እስካሁን የሚታይ ነገር የለም።' },
  'common.error': { en: 'Something went wrong.', am: 'የሆነ ስህተት ተከስቷል።' },
} satisfies Record<string, Record<Language, string>>;

export type TranslationKey = keyof typeof dictionary;

export function t(
  key: TranslationKey,
  lang: Language = 'en',
  vars?: Record<string, string | number>
): string {
  const entry = dictionary[key];
  let text = entry ? (entry[lang] ?? entry.en) : String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export function translator(lang: Language) {
  return (key: TranslationKey, vars?: Record<string, string | number>) => t(key, lang, vars);
}

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'am';
}
