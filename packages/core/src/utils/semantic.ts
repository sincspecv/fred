/**
 * Simple semantic matching using string similarity
 * For production, this should use embeddings from an AI platform
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) {
    return 1.0;
  }

  // Calculate Levenshtein distance
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Semantic matcher function for intent matching
 * Returns the best match if similarity is above threshold
 */
export async function semanticMatch(
  message: string,
  utterances: string[],
  threshold: number = 0.6
): Promise<{ matched: boolean; confidence: number; utterance?: string }> {
  let bestMatch: { confidence: number; utterance: string } | null = null;

  for (const utterance of utterances) {
    const similarity = calculateSimilarity(
      message.toLowerCase(),
      utterance.toLowerCase()
    );

    if (!bestMatch || similarity > bestMatch.confidence) {
      bestMatch = { confidence: similarity, utterance };
    }
  }

  if (bestMatch && bestMatch.confidence >= threshold) {
    return {
      matched: true,
      confidence: bestMatch.confidence,
      utterance: bestMatch.utterance,
    };
  }

  return { matched: false, confidence: 0 };
}


