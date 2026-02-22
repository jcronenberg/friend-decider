// score = (favor * 2) + (neutral * 0) + (against * -5)
// Un-voted participants count as "in favor" at scoring time

export function rankItems(session) {
  const totalParticipants = session.participants.size;

  const scored = [...session.items.values()].map(item => {
    let favor = 0;
    let neutral = 0;
    let against = 0;

    for (const [participantId] of session.participants) {
      const vote = item.votes.get(participantId);
      if (vote === 'against') against++;
      else if (vote === 'neutral') neutral++;
      else favor++; // 'favor' or unvoted both count as favor
    }

    const score = favor * 2 + neutral * 0 + against * -5;

    return {
      id: item.id,
      text: item.text,
      addedBy: item.addedBy,
      score,
      votes: { favor, neutral, against },
      totalParticipants,
    };
  });

  // Sort: higher score first, then fewer against, then more in favor, then alphabetical
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.votes.against !== b.votes.against) return a.votes.against - b.votes.against;
    if (b.votes.favor !== a.votes.favor) return b.votes.favor - a.votes.favor;
    return a.text.localeCompare(b.text);
  });

  return scored;
}
