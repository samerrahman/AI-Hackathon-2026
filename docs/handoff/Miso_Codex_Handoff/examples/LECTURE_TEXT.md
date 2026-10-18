# Original sample lecture texts

These are synthetic, original teaching fixtures prepared for this handoff. They are not Stanford or UCLA course materials and are not attributed to an instructor. The application should ingest the PDFs normally. This text is an accessible companion and an evaluation reference, not a hardcoded answer database for live mode.

# Sequences and convergence

## Page 1 — Boundedness

A real sequence is an ordered list a₁, a₂, a₃, … indexed by the positive integers. Its order and repetitions matter. The set of values taken by a sequence does not retain all this information.

A sequence is bounded above if there is a real number U such that aₙ ≤ U for every n. It is bounded below if there is a real number L such that L ≤ aₙ for every n. It is bounded if both conditions hold. Equivalently, there is M ≥ 0 with |aₙ| ≤ M for every n.

The sequence aₙ = 1/n is bounded: 0 < aₙ ≤ 1 for every positive integer n. The sequence bₙ = (−1)ⁿ is also bounded, because −1 ≤ bₙ ≤ 1. Boundedness describes where the terms can lie; it does not say that they approach a single value.

A bound need not be a term of the sequence, and it need not be the best possible bound. For aₙ = 1/n, both 1 and 2 are upper bounds, but 1 is the least upper bound of the set of values. The lower bound 0 is never attained.

Do not confuse “all terms remain in a fixed finite interval” with “the terms eventually stay close to one point.” The first describes boundedness; the second belongs to convergence.

Questions to explain: What does a bound have to control? Can a bounded sequence keep oscillating? Must a lower bound be one of the terms?

## Page 2 — Convergence and quantifiers

A sequence aₙ converges to a real number ℓ if, for every ε > 0, there exists a positive integer N such that, for every n ≥ N, |aₙ − ℓ| < ε.

The order of the choices matters. N may depend on ε, but after N has been selected it must work for every later index n. The definition does not allow a new N to be chosen separately for each term.

For aₙ = 1/n, given ε > 0, choose an integer N > 1/ε. For every n ≥ N, 0 < 1/n ≤ 1/N < ε. Thus the sequence converges to 0.

Every convergent real sequence is bounded. To see this, use ε = 1 to place all sufficiently late terms in the interval (ℓ − 1, ℓ + 1). There are only finitely many earlier terms. A sufficiently large bound can cover those terms as well as the tail.

The converse is false. The bounded sequence bₙ = (−1)ⁿ alternates between −1 and 1 and does not converge. If it converged to ℓ, then for ε = 1/2 all sufficiently late terms would lie within 1/2 of ℓ. Taking a late even index and a late odd index would give 2 = |1 − (−1)| ≤ |1 − ℓ| + |ℓ + 1| < 1, a contradiction.

Questions to explain: Why must the same N work for all later terms? Why do finitely many early terms not prevent convergence or boundedness? Why is boundedness insufficient for convergence?

## Page 3 — Monotone convergence

A sequence is nondecreasing if aₙ₊₁ ≥ aₙ for every n. It is nonincreasing if aₙ₊₁ ≤ aₙ for every n. A sequence is monotone if it has either of these properties. Equal consecutive terms are allowed.

Every bounded monotone sequence of real numbers converges.

More precisely, a nondecreasing sequence that is bounded above converges to the supremum of its set of values. A nonincreasing sequence that is bounded below converges to the infimum of its set of values.

Proof in the nondecreasing case: Let s be the supremum of {aₙ : n ≥ 1}, which exists by completeness. Given ε > 0, s − ε cannot be an upper bound for all the terms. Therefore some term a_N satisfies s − ε < a_N ≤ s. By monotonicity, for every n ≥ N we have s − ε < a_N ≤ aₙ ≤ s. Hence |aₙ − s| < ε, proving convergence to s.

Both ideas matter. Boundedness supplies a finite supremum; monotonicity makes the entire tail stay above the term already found near that supremum. Boundedness alone permits oscillation. Monotonicity alone permits divergence to infinity, as with aₙ = n.

Questions to explain: Where is completeness used? Where is monotonicity used? Why does finding just one term near s not by itself control every later term?

## Page 4 — Subsequences

A subsequence of aₙ is a sequence aₙₖ obtained by choosing a strictly increasing sequence of positive integer indices n₁ < n₂ < n₃ < …. The indices must keep moving forward, but the values need not be increasing.

If aₙ converges to ℓ, every subsequence also converges to ℓ. Given ε > 0, choose N for the original sequence. Strictly increasing positive integer indices satisfy nₖ ≥ k. Therefore, when k ≥ N, the term aₙₖ is also far enough along the original sequence to be within ε of ℓ.

A convergent subsequence does not imply that the whole sequence converges. For bₙ = (−1)ⁿ, the even-indexed subsequence is constantly 1 and the odd-indexed subsequence is constantly −1. Each subsequence converges, but the original sequence does not.

The Bolzano–Weierstrass theorem for real sequences states that every bounded real sequence has a convergent subsequence. It guarantees a convergent subsequence, not convergence of the entire sequence.

Questions to explain: Why must subsequence indices be strictly increasing? How do the even and odd subsequences distinguish boundedness from convergence? Which word changes the claim in Bolzano–Weierstrass?

# Experiments and causal claims

## Page 1 — Sampling and assignment

A population is the group about which a study wants to draw conclusions. A sample is the group actually observed. Random sampling is a method of selecting observations from a population using a random mechanism with defined selection probabilities. It can support population inference, subject to the sampling design, nonresponse, and other limitations.

Random assignment is a method of assigning study participants to treatment conditions using a random mechanism. It aims to make treatment groups comparable in expectation before treatment. It does not guarantee identical groups in every realized experiment.

Random sampling and random assignment answer different questions. Sampling concerns who enters the study; assignment concerns which treatment participants receive. A study can use either, both, or neither.

Example: Students volunteer for a study of a study-planning app. The researchers randomly assign the volunteers to use the app or to continue their usual routine. This is random assignment within a volunteer sample. The design can support a causal comparison for the study participants under appropriate assumptions, but the volunteers may differ from the wider student population.

Example: Researchers randomly sample students from a university roster and observe their existing study habits. This is random sampling without random assignment of habits. A representative sample does not by itself turn an observed relationship between habits and grades into a causal effect.

Questions to explain: Which process affects group comparability? Which process affects population coverage? Can a randomized experiment still have limited generalizability?

## Page 2 — Association, confounding, and limits

An association means two variables vary together in the observed data. A causal claim says that changing one variable would change another under specified conditions. An association alone does not establish such a claim.

A confounder is a variable related to the treatment or exposure and the outcome in a way that can distort the observed association. In a study of app use and grades, prior motivation may influence both the decision to use the app and academic performance.

Random assignment addresses systematic pre-treatment differences between groups in expectation. It does not automatically solve every problem: differential dropout, noncompliance, measurement problems, or interference between participants can still complicate interpretation.

Suppose volunteers randomly assigned to the app group have higher average grades at the end of a well-conducted study. This is stronger evidence for a causal effect in that study than a simple observation that app users have higher grades. Extending the result to all college students requires considering the population, sample, implementation, and setting.

A careful conclusion distinguishes the design's causal support from the scope of generalization. “Random assignment” does not mean “random sample,” and “random sample” does not mean “causation established.”

Questions to explain: How could motivation create an association without an app effect? Why is random assignment useful even though realized groups may differ by chance? What additional question remains when generalizing beyond volunteers?
