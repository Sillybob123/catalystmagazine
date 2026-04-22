import { el, esc } from "./ui.js";

const QUICK_CHECKLIST = [
  "Write a lead that earns attention and promises a payoff.",
  "Make sure the piece has a concrete angle, not just a broad topic.",
  "Check that every section moves the story forward.",
  "Attribute every quote and ground every factual claim in reporting.",
  "Define scientific terms for a college-level, science-literate reader.",
  "Avoid prescriptive language unless the piece is explicitly an op-ed.",
  "Re-verify any technical claim that feels even slightly uncertain.",
  "End on a kicker that lands instead of summarizing the piece.",
];

const SECTIONS = [
  {
    id: "foundation",
    number: "01",
    label: "Foundation",
    title: "Know Your Audience",
    intro: "Every writing decision - vocabulary, assumed knowledge, level of explanation - flows from a clear picture of who is reading. At Catalyst, that picture is specific.",
    bodyHtml: `
      <div class="standards-subhead">The Catalyst Reader</div>
      <p>Catalyst is written for students in college and above who are into science. This is your north star. Readers are intellectually curious and science-literate, but they are not necessarily experts in your specific topic. Assume intelligence without assuming specialized knowledge.</p>
      <div class="standards-feature-grid">
        <article class="standards-feature-card">
          <h4>Curious, Not Expert</h4>
          <p>Your reader is engaged with science broadly, but probably is not a specialist in your topic. Explain concepts clearly without condescension. Respect their intelligence.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Accessible Language</h4>
          <p>Define jargon the first time you use it. Never assume a term is universally known. When in doubt, add a brief one-clause explanation in parentheses or the next sentence.</p>
        </article>
        <article class="standards-feature-card">
          <h4>College-Level Reading</h4>
          <p>You are not writing for a general newspaper audience, and you are not writing a journal abstract. Aim for a well-written science magazine article: substantive, but readable.</p>
        </article>
      </div>
    `,
  },
  {
    id: "lead",
    number: "02",
    label: "Structure",
    title: "Writing the Lead",
    intro: "The lead (or lede) is the most important sentence - or paragraph - in your piece. It is the only thing standing between your story and a reader clicking away. Get it wrong and nothing else matters.",
    bodyHtml: `
      <div class="standards-subhead">The Surprising Lead</div>
      <p>The best leads are surprising. They give the reader something they did not expect: an unexpected fact, a counterintuitive finding, a vivid scene, or a provocative question that reframes how to think about the topic. A surprising lead tells the reader this story is worth their time.</p>

      <div class="standards-subhead">What a Lead Must Accomplish</div>
      <div class="standards-feature-grid">
        <article class="standards-feature-card">
          <h4>Hook the reader immediately</h4>
          <p>You have one sentence to earn the second sentence. Every word counts.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Signal the stakes</h4>
          <p>Why does this matter? Why now? The lead should make the urgency or wonder of the topic felt right away.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Set the tone</h4>
          <p>Is this a mystery, a surprising discovery, or a human story? The lead establishes the emotional register for everything that follows.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Create a promise</h4>
          <p>The lead implicitly says: if you keep reading, I will answer this question or deliver this payoff. Then keep that promise.</p>
        </article>
      </div>

      <div class="standards-subhead">Lead Types to Know</div>
      <div class="standards-compare-grid">
        <article class="standards-compare-card">
          <div class="standards-compare-label">Anecdote Lead</div>
          <p>Open with a specific moment, scene, or person that illustrates the broader topic. This grounds abstract science in a human story and works especially well for features.</p>
        </article>
        <article class="standards-compare-card">
          <div class="standards-compare-label">Surprising Fact Lead</div>
          <p>Lead with a counterintuitive or astonishing statistic or finding. Example: "Despite decades of research, scientists still cannot explain why..."</p>
        </article>
        <article class="standards-compare-card">
          <div class="standards-compare-label">Question Lead</div>
          <p>Use sparingly. It only works when the question itself is genuinely surprising. Avoid vague rhetorical openings like "Have you ever wondered...?"</p>
        </article>
        <article class="standards-compare-card standards-compare-card--warn">
          <div class="standards-compare-label">Summary Lead (avoid)</div>
          <p>A dry summary like "This article examines..." or "Researchers at GW have discovered..." reads like a press release. Save that style for briefs, not features.</p>
        </article>
      </div>

      <aside class="standards-callout standards-callout--dark">
        <div class="standards-callout-label">Pro Tip</div>
        <p>Write your lead last. Once you know the full story - every quote, finding, and twist - you will know which detail is actually the most surprising or compelling. Most better leads are hiding in the middle of a first draft.</p>
      </aside>
    `,
  },
  {
    id: "angle",
    number: "03",
    label: "Reporting",
    title: "Finding Your Angle",
    intro: "Every good science story starts not with a topic, but with an angle - a specific, concrete lens through which a broader theme becomes real and readable. The angle is the difference between a story and an essay.",
    bodyHtml: `
      <div class="standards-subhead">The Local Window Into a Global Story</div>
      <p>One powerful approach is to find a local, specific example that illuminates a global trend. Writing about AI in higher education? Zoom in on a pioneering program right here in the DMV. The specific grounds the abstract, gives readers something concrete to connect with, and gives you someone you can actually interview.</p>

      <div class="standards-subhead">Questions to Find Your Angle</div>
      <ol class="standards-number-list">
        <li><strong>What is the most surprising thing I learned while researching this?</strong> Start there.</li>
        <li><strong>Is there a specific person, place, lab, or program that embodies the broader trend?</strong> Use it as your entry point.</li>
        <li><strong>What does my reader not know that they should?</strong> What assumptions does this story challenge?</li>
        <li><strong>What is the unresolved tension in this topic?</strong> Good stories live between what we know and what we do not.</li>
        <li><strong>Why does this matter right now?</strong> What makes this the moment to tell the story?</li>
      </ol>

      <div class="standards-subhead">Topic vs. Angle</div>
      <div class="standards-example-stack">
        <article class="standards-compare-card standards-compare-card--warn">
          <div class="standards-compare-label">Too Broad (No Angle)</div>
          <p>"This article looks at the role of AI in higher education."</p>
          <p class="standards-muted">This is a topic, not a story. There is no specific institution, person, conflict, or moment.</p>
        </article>
        <div class="standards-example-arrow">Then sharpen it.</div>
        <article class="standards-compare-card standards-compare-card--good">
          <div class="standards-compare-label">Specific Angle</div>
          <p>"UMD is one of a handful of universities in the country to have launched a dedicated AI literacy major - and it is drawing students from every discipline."</p>
          <p class="standards-muted">Specific institution. Concrete claim. Implied stakes. Now the reader has a reason to keep going.</p>
        </article>
      </div>
    `,
  },
  {
    id: "headlines",
    number: "04",
    label: "Craft",
    title: "Headlines & Titles",
    intro: "A headline is a promise and a sales pitch compressed into a single line. It needs to stop a scrolling reader, convey the story's value, and make them click - without being misleading or clickbaity.",
    bodyHtml: `
      <div class="standards-subhead">Go Aggressive</div>
      <p>Do not default to the safe, vague headline. Push for something with energy. Strong modifiers can stress urgency and importance: urgent, necessary, essential, critical, first, already. The title should carry the same weight as the story it introduces.</p>

      <div class="standards-subhead">Headline Principles</div>
      <div class="standards-feature-grid">
        <article class="standards-feature-card">
          <h4>Active</h4>
          <p>Prefer active voice. "Scientists discover a protein that erases fear" is stronger than "A protein has been discovered that may affect fear memory."</p>
        </article>
        <article class="standards-feature-card">
          <h4>Specific</h4>
          <p>Avoid vague titles like "A New Study Changes Everything." Specificity creates trust and curiosity at the same time.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Stakes</h4>
          <p>Tell the reader why this matters to them, to science, or to society. Stakes are part of the hook.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Honest</h4>
          <p>Never overpromise. If the story is qualified, the headline must be qualified too. "May help" is not the same as "cures."</p>
        </article>
      </div>

      <div class="standards-subhead">Title Workshop: Before & After</div>
      <div class="standards-pair-table">
        <div class="standards-pair-row">
          <div class="standards-pair-cell standards-pair-cell--before">
            <div class="standards-compare-label">Before</div>
            <p>AI in Universities: A Growing Trend</p>
          </div>
          <div class="standards-pair-cell standards-pair-cell--after">
            <div class="standards-compare-label">After</div>
            <p>The AI Literacy Major That Could Reshape Every Campus</p>
          </div>
        </div>
        <div class="standards-pair-row">
          <div class="standards-pair-cell standards-pair-cell--before">
            <div class="standards-compare-label">Before</div>
            <p>Research on Memory and Protein</p>
          </div>
          <div class="standards-pair-cell standards-pair-cell--after">
            <div class="standards-compare-label">After</div>
            <p>Scientists Found the Protein That Lets Your Brain Forget Fear</p>
          </div>
        </div>
        <div class="standards-pair-row">
          <div class="standards-pair-cell standards-pair-cell--before">
            <div class="standards-compare-label">Before</div>
            <p>A Look at Climate Change Effects</p>
          </div>
          <div class="standards-pair-cell standards-pair-cell--after">
            <div class="standards-compare-label">After</div>
            <p>These Chesapeake Bay Ecosystems Are Already Past the Point of No Return</p>
          </div>
        </div>
      </div>
    `,
  },
  {
    id: "voice",
    number: "05",
    label: "Identity",
    title: "Voice & Credibility",
    intro: "Science journalism demands a paradox: write with personality and conviction while maintaining the rigorous credibility of a scientist. Neither should be sacrificed. The goal is a voice that feels both authoritative and alive.",
    bodyHtml: `
      <div class="standards-subhead">Your Voice</div>
      <p>Your voice is what makes a reader finish your article instead of someone else's version of the same topic. It is your rhythm, your curiosity on the page, and the way you frame a question. Protect it. The best science writers make bold, clear statements and let the evidence support them.</p>

      <div class="standards-subhead">Credibility</div>
      <p>Credibility is what makes a reader trust you. It comes from accurate science, honest attribution, appropriate caveats, and not overstating what the research actually says. Think of credibility as the foundation your voice stands on. If the foundation is weak, the whole piece collapses.</p>

      <div class="standards-subhead">How to Let the Story Drive</div>
      <p>Research culture trains you to present facts neutrally, but storytelling rewards bold statements. The answer is not to abandon one for the other. Let the story make the bold claim, supported by the evidence you have reported.</p>

      <div class="standards-compare-grid standards-compare-grid--tight">
        <article class="standards-compare-card standards-compare-card--warn">
          <div class="standards-compare-label">Too Flat</div>
          <p>"There is evidence suggesting that AI literacy programs may have positive effects on student outcomes."</p>
          <p class="standards-muted">Passive and hedged to the point of meaninglessness.</p>
        </article>
        <article class="standards-compare-card standards-compare-card--bad">
          <div class="standards-compare-label">Too Editorial</div>
          <p>"Universities must integrate AI literacy and competency into their curriculum."</p>
          <p class="standards-muted">That is the writer's opinion, not the reported conclusion of the story.</p>
        </article>
        <article class="standards-compare-card standards-compare-card--good">
          <div class="standards-compare-label">Just Right</div>
          <p>"UMD's AI literacy program is one of fewer than a dozen of its kind nationwide - and early data suggests its graduates are landing internships at twice the rate of peers from traditional CS programs."</p>
          <p class="standards-muted">Bold, specific, and evidence-grounded. The facts do the arguing.</p>
        </article>
      </div>

      <p>Different publications have different style guides and editorial personalities. The writers who thrive across outlets learn those constraints and still sound like themselves inside them.</p>
    `,
  },
  {
    id: "opinion",
    number: "06",
    label: "Integrity",
    title: "Opinion vs. Reporting",
    intro: "This is one of the most common - and most consequential - lines for new science writers to learn. Crossing it without noticing can undermine the entire piece.",
    bodyHtml: `
      <aside class="standards-callout standards-callout--warn">
        <div class="standards-callout-label">Red Flag: Prescriptive Language</div>
        <p>As soon as you write phrases like "universities must," "we should," "it is imperative that," or "scientists need to," you have shifted from reporting to editorializing. Unless you are writing an op-ed, your job is to report what is and what research shows, not tell institutions or people what to do.</p>
      </aside>

      <div class="standards-subhead">The Distinction in Practice</div>
      <div class="standards-pair-table">
        <div class="standards-pair-row">
          <div class="standards-pair-cell">
            <div class="standards-compare-label">Reporting</div>
            <p>"Experts say AI literacy is increasingly seen as a core competency for graduates entering today's workforce."</p>
          </div>
          <div class="standards-pair-cell">
            <div class="standards-compare-label">Editorializing</div>
            <p>"Universities must integrate AI literacy into their curriculum immediately."</p>
          </div>
        </div>
        <div class="standards-pair-row">
          <div class="standards-pair-cell">
            <div class="standards-compare-label">Reporting</div>
            <p>"The study found that early dietary interventions reduced obesity rates by 34% in participating schools."</p>
          </div>
          <div class="standards-pair-cell">
            <div class="standards-compare-label">Editorializing</div>
            <p>"Schools need to prioritize nutrition education before it is too late."</p>
          </div>
        </div>
        <div class="standards-pair-row">
          <div class="standards-pair-cell">
            <div class="standards-compare-label">Reporting</div>
            <p>"Researchers argue the findings challenge existing protocols and may warrant a policy review."</p>
          </div>
          <div class="standards-pair-cell">
            <div class="standards-compare-label">Editorializing</div>
            <p>"This research proves that current policy is wrong and must change."</p>
          </div>
        </div>
      </div>

      <p>Notice what happens in the reporting examples: urgency and interpretation are still present, but they belong to experts, data, or researchers. Your job is to relay those conclusions faithfully and clearly.</p>

      <div class="standards-subhead">Op-Eds Are the Exception</div>
      <p>Op-eds are explicitly opinion pieces and have different rules. Catalyst publishes both reported features and op-eds. Know which format you are writing before you start. If a reported feature starts drifting into opinion, flag it with your editor or consider whether the idea belongs in the op-ed section instead.</p>
    `,
  },
  {
    id: "accuracy",
    number: "07",
    label: "Standards",
    title: "Technical Accuracy",
    intro: "Science journalism lives or dies on accuracy. A single factual error - especially on the underlying science - can destroy the credibility of an otherwise excellent piece. In science, the consequences of misinformation can be real.",
    bodyHtml: `
      <ol class="standards-number-list standards-number-list--cards">
        <li><strong>Do not paraphrase if you are not sure.</strong> When you restate a scientific concept, ask whether you could explain exactly why it is true. If not, go back to the papers, experts, or textbooks until you can.</li>
        <li><strong>Email your sources when uncertain.</strong> If the paper left you confused, do not guess. Ask the researcher to clarify the mechanism. They would rather answer a short email than see the work misrepresented in print.</li>
        <li><strong>Be precise with mechanism descriptions.</strong> Terms like strengthens, weakens, activates, inhibits, promotes, and erases are not interchangeable in biology. If you are not sure which verb is right, that is the signal to return to the source.</li>
        <li><strong>Read the primary source.</strong> Do not rely only on press releases, university news pages, or secondary summaries. Read the paper itself and make sure you understand both what the researchers are claiming and what they are not.</li>
        <li><strong>Flag uncertainty in your draft.</strong> If you are not confident about a claim when submitting, say so in a comment for your editor. Transparency is always better than silent guessing.</li>
      </ol>

      <aside class="standards-callout">
        <div class="standards-callout-label">Team Science</div>
        <p>If you are stuck on a technical concept, bring it to the team. Someone with a different background may be able to quickly clarify a mechanism that is slowing you down. Catalyst is a collaborative publication. Use your colleagues.</p>
      </aside>
    `,
  },
  {
    id: "depth",
    number: "08",
    label: "Structure",
    title: "Depth vs. Breadth",
    intro: "One of the trickiest challenges in science journalism is giving readers real substance without losing them in the weeds - and keeping depth without closing off your audience.",
    bodyHtml: `
      <aside class="standards-callout standards-callout--warn">
        <div class="standards-callout-label">Do Not Write a Literature Review</div>
        <p>One of the most common traps for science-trained writers is producing an article that reads like a survey paper: comprehensive, citation-heavy, methodologically accurate, and completely unreadable. Catalyst readers want a story, not a systematic review.</p>
      </aside>

      <div class="standards-subhead">Strategies for the Balance</div>
      <div class="standards-feature-grid">
        <article class="standards-feature-card">
          <h4>Use One Case to Tell the Whole Story</h4>
          <p>Instead of listing ten studies, go deep on one. Explain one research team's methodology in human terms, then zoom back out to show how it fits into the larger picture.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Prioritize Ruthlessly</h4>
          <p>Not every fact you learned belongs in the article. Ask whether a detail moves the story forward or helps the reader understand the core finding. If not, cut it.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Let Experts Do the Heavy Lifting</h4>
          <p>You do not need to explain every technical nuance yourself. Quote your sources and put those quotes in the right context and sequence.</p>
        </article>
        <article class="standards-feature-card">
          <h4>Use Structure as a Guide</h4>
          <p>If you have 2,000 words and no through-line, the problem is usually structure. Outline before you write. Know the lead, the three key sections, and the kicker.</p>
        </article>
      </div>

      <div class="standards-subhead">Niche Pieces Are Okay - With the Right Frame</div>
      <p>Catalyst publishes both broadly accessible pieces and deeper, more technical articles. A niche deep-dive is not automatically wrong. It still needs a frame that makes the non-expert care: start broad, go narrow, and come back broad.</p>
    `,
  },
  {
    id: "endings",
    number: "09",
    label: "Craft",
    title: "Endings & Kickers",
    intro: "A great ending does not just stop the article - it lands it. The final paragraph, or kicker, is your last impression and your last chance to resonate.",
    bodyHtml: `
      <div class="standards-compare-grid">
        <article class="standards-compare-card">
          <div class="standards-compare-label">The Quote Kicker</div>
          <p>The most reliable ending in science journalism. End with a quote that captures the story's emotional or intellectual core - something forward-looking, poetic, or unexpectedly candid.</p>
        </article>
        <article class="standards-compare-card">
          <div class="standards-compare-label">The Callback Kicker</div>
          <p>Return to something from the lead - an image, a character, or an unanswered question - and resolve it or reframe it with new meaning.</p>
        </article>
        <article class="standards-compare-card">
          <div class="standards-compare-label">The Implication Kicker</div>
          <p>End with the larger implication of the story: the next question, the future it points toward, or the bigger puzzle this finding fits into.</p>
        </article>
      </div>

      <div class="standards-subhead">Mining for Your Kicker</div>
      <ul class="standards-checklist">
        <li>Look for quotes that express wonder, uncertainty, or unexpected candor about the research.</li>
        <li>Look for statements about what the researcher hopes to discover next, or what still puzzles them.</li>
        <li>Look for a detail or anecdote that did not fit elsewhere but still carries emotional resonance.</li>
        <li>Look for the moment in the interview where the source said something you were not expecting. That is often where the real ending lives.</li>
      </ul>

      <aside class="standards-callout standards-callout--warn">
        <div class="standards-callout-label">Avoid the Summary Ending</div>
        <p>Do not end with a paragraph that simply summarizes what the article covered. The reader already knows what they read. A kicker should add something new: a resonant quote, an emotional note, or a forward-looking implication.</p>
      </aside>
    `,
  },
  {
    id: "workflow",
    number: "10",
    label: "Workflow",
    title: "The Editing Process",
    intro: "Great journalism is not written in isolation - it is written in collaboration. Editing is not a judgment; it is the final stage of making the work as strong as it can be.",
    bodyHtml: `
      <ol class="standards-number-list standards-number-list--cards">
        <li><strong>Submit your draft openly.</strong> Sharing an unfinished draft with editors and colleagues is an act of trust. Do not defend first drafts. The goal is to improve the story, not protect the first version of it.</li>
        <li><strong>Read all editor comments before responding.</strong> Understand the full pattern of the feedback before making changes. Individual notes often point to a larger structural issue.</li>
        <li><strong>Question edits you do not understand.</strong> Ask why a change was suggested. Understanding the reasoning behind edits makes every future draft better.</li>
        <li><strong>Verify after edits.</strong> If an edit changes a technical claim or mechanism, re-check it. Editing can introduce scientific errors, even with good intentions.</li>
        <li><strong>Disagreement is welcome.</strong> If you disagree with an editor's suggestion, say so respectfully and explain why. Passive acceptance does not help your piece or your growth.</li>
      </ol>

      <aside class="standards-callout standards-callout--dark">
        <div class="standards-callout-label">The Editorial Session Is a Learning Opportunity</div>
        <p>Every group editing session - like the ones we hold with Professor Kintisch - is a masterclass in disguise. Even when it is not your piece being reviewed, the lessons transfer: the same structure problems, voice issues, and credibility traps show up again and again.</p>
      </aside>
    `,
  },
  {
    id: "checklist",
    number: "11",
    label: "Quick Reference",
    title: "Writer's Quick-Reference Checklist",
    intro: "Run through this before submitting any draft.",
    bodyHtml: `
      <ul class="standards-checklist standards-checklist--boxed">
        ${QUICK_CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("")}
      </ul>
    `,
  },
];

export async function mount(ctx, container) {
  container.innerHTML = "";

  const page = el("div", { class: "standards-page" });
  page.innerHTML = `
    <div class="standards-layout">
      <aside class="standards-toc" aria-label="Section navigation">
        <div class="standards-toc-card">
          <div class="standards-toc-eyebrow">Jump to a section</div>
          <div class="standards-toc-list">
            ${SECTIONS.map((section) => `
              <button class="standards-toc-link" type="button" data-section-target="${esc(section.id)}">
                <span class="standards-toc-number">${esc(section.number)}</span>
                <span class="standards-toc-text">
                  <span class="standards-toc-label">${esc(section.label)}</span>
                  <span class="standards-toc-title">${esc(section.title)}</span>
                </span>
              </button>
            `).join("")}
          </div>
        </div>
      </aside>

      <div class="standards-content">
        ${SECTIONS.map((section) => `
          <section class="standards-section" id="${esc(section.id)}" data-section-id="${esc(section.id)}">
            <div class="standards-section-header">
              <div class="standards-section-number">${esc(section.number)}</div>
              <div class="standards-section-headcopy">
                <div class="standards-section-label">${esc(section.label)}</div>
                <h3 class="standards-section-title">${esc(section.title)}</h3>
                <p class="standards-section-intro">${esc(section.intro)}</p>
              </div>
            </div>
            <div class="standards-body-flow">
              ${section.bodyHtml}
            </div>
          </section>
        `).join("")}
      </div>
    </div>
  `;
  container.appendChild(page);

  const sectionEls = Array.from(page.querySelectorAll("[data-section-id]"));
  const tocButtons = Array.from(page.querySelectorAll("[data-section-target]"));
  let activeSectionId = sectionEls[0]?.id || null;

  const setActiveSection = (id) => {
    if (!id || id === activeSectionId) return;
    activeSectionId = id;
    tocButtons.forEach((button) => {
      const isActive = button.dataset.sectionTarget === id;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-current", isActive ? "true" : "false");
    });
    sectionEls.forEach((section) => section.classList.toggle("is-active", section.id === id));
  };

  const scrollToSection = (id, behavior = "smooth") => {
    const target = sectionEls.find((section) => section.id === id);
    if (!target) return;
    target.scrollIntoView({ behavior, block: "start" });
    setActiveSection(id);
  };

  const updateSectionParam = (id) => {
    history.replaceState(null, "", `#/writer/guidelines?section=${encodeURIComponent(id)}`);
  };

  const buttonHandlers = tocButtons.map((button) => {
    const handler = () => {
      const id = button.dataset.sectionTarget;
      updateSectionParam(id);
      scrollToSection(id, "smooth");
    };
    button.addEventListener("click", handler);
    return { button, handler };
  });

  tocButtons.forEach((button, index) => {
    const isFirst = index === 0;
    button.classList.toggle("active", isFirst);
    button.setAttribute("aria-current", isFirst ? "true" : "false");
  });
  if (sectionEls[0]) sectionEls[0].classList.add("is-active");

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => {
        if (b.intersectionRatio !== a.intersectionRatio) {
          return b.intersectionRatio - a.intersectionRatio;
        }
        return a.boundingClientRect.top - b.boundingClientRect.top;
      });

    if (!visible.length) return;
    setActiveSection(visible[0].target.id);
  }, {
    rootMargin: "-18% 0px -58% 0px",
    threshold: [0.1, 0.2, 0.35, 0.6],
  });

  sectionEls.forEach((section) => observer.observe(section));

  const requestedSection = new URLSearchParams(location.hash.split("?")[1] || "").get("section");
  if (requestedSection && sectionEls.some((section) => section.id === requestedSection)) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollToSection(requestedSection, "auto");
      }, 40);
    });
  }

  return () => {
    observer.disconnect();
    buttonHandlers.forEach(({ button, handler }) => button.removeEventListener("click", handler));
  };
}
