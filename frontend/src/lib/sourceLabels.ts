const SOURCE_LABELS: Record<string, string> = {
  tavily: 'Web Search',
  tavily_live_search: 'Web Search',
  nigerian_news: 'Online News',
  'nigerian news feed': 'Online News',
  twitter: 'X',
  'twitter/x': 'X',
  reddit: 'Reddit',
  youtube: 'YouTube',
  facebook: 'Facebook',
  google_reviews: 'Google Reviews',
  'google reviews': 'Google Reviews',
  google_maps: 'Google Maps',
};

export function sourceLabel(value: string | null | undefined): string {
  if (!value?.trim()) return 'Unknown source';
  const normalized = value.trim().toLowerCase();
  return SOURCE_LABELS[normalized]
    || normalized.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
