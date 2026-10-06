import { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  FileText,
  GitBranch,
} from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const suggestions = [
  {
    category: 'Education',
    query: 'How does generative AI affect critical thinking in students?',
    terms: 'generative AI critical thinking students',
    image: 'education',
  },
  {
    category: 'Environment',
    query: 'Can urban green spaces improve mental health?',
    terms: 'urban green space mental health',
    image: 'forest',
  },
  {
    category: 'Technology',
    query: 'What makes retrieval-augmented generation more reliable?',
    terms: 'retrieval augmented generation reliability',
    image: 'technology',
  },
];

const steps = [
  {
    title: 'Bring an idea.',
    description:
      'A topic, a question, a connection you want to explore. Start with what you want to know.',
    Icon: BookOpen,
    example: '“Can greener cities help us feel better?”',
  },
  {
    title: 'See the connections.',
    description:
      'Agent-assisted search maps the concepts in your question and turns them into paths through the literature.',
    Icon: GitBranch,
    example: 'Urban green space → mental health → wellbeing',
  },
  {
    title: 'Follow the evidence.',
    description:
      'Explore studies from OpenAlex. Follow their DOIs, read available papers, and save the ones that matter.',
    Icon: FileText,
    example: 'Full titles. Original sources. Your reading list.',
  },
];

export default function DiscoveryIntro({
  onChoose,
  onStart,
}: {
  onChoose: (idea: string, terms: string) => void;
  onStart: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.suggestions-heading, .suggestion-grid', {
          y: 24,
          opacity: 0,
          stagger: 0.12,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: '.suggestions',
            start: 'top 90%',
            once: true,
          },
        });
        gsap.fromTo(
          '.reveal-word',
          { opacity: 0.2 },
          {
            opacity: 1,
            stagger: 0.15,
            ease: 'none',
            scrollTrigger: {
              trigger: '.workflow-copy',
              start: 'top 85%',
              end: 'bottom 45%',
              scrub: 0.6,
            },
          },
        );
        const cards = gsap.utils.toArray<HTMLElement>('.workflow-card');
        cards.slice(0, -1).forEach((card, index) => {
          gsap.to(card, {
            scale: 0.94,
            opacity: 0.45,
            ease: 'none',
            scrollTrigger: {
              trigger: cards[index + 1],
              start: 'top 65%',
              end: 'top 25%',
              scrub: true,
            },
          });
        });
      });
      return () => media.revert();
    },
    { scope: container },
  );

  return (
    <div ref={container} className="discovery-intro">
      <section className="suggestions" aria-labelledby="suggestions-title">
        <div className="suggestions-heading">
          <div>
            <p className="eyebrow">A PLACE TO START</p>
            <h2 id="suggestions-title">
              Big questions.<span> Small first steps.</span>
            </h2>
          </div>
          <div className="carousel-controls" aria-label="Browse research ideas">
            <span className="sr-only" aria-live="polite">
              Featured idea: {suggestions[active].category}
            </span>
            <button
              className="icon-button"
              aria-label="Previous research idea"
              onClick={() =>
                setActive(
                  (active + suggestions.length - 1) % suggestions.length,
                )
              }
            >
              <ArrowLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Next research idea"
              onClick={() => setActive((active + 1) % suggestions.length)}
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
        <div className="suggestion-grid">
          {suggestions.map((suggestion, index) => (
            <button
              className={`suggestion-card ${active === index ? 'suggestion-active' : ''}`}
              key={suggestion.category}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onClick={() => onChoose(suggestion.query, suggestion.terms)}
              aria-label={`Explore: ${suggestion.query}`}
            >
              <img
                src={`https://picsum.photos/seed/${suggestion.image}/1920/1080`}
                alt=""
                loading="lazy"
              />
              <span className="suggestion-top">
                <span>{suggestion.category}</span>
                <ArrowUpRight size={20} />
              </span>
              <span className="suggestion-query">{suggestion.query}</span>
              <span className="suggestion-bottom">
                Explore this idea <ArrowRight size={17} />
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="research-marquee" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <span key={copy}>
              Questions <i /> Concepts <i /> Literature <i /> Connections <i />{' '}
              Discovery <i />
            </span>
          ))}
        </div>
      </div>

      <section className="how-it-works" aria-labelledby="workflow-title">
        <div className="workflow-copy">
          <p className="eyebrow">A CLEARER PATH INTO THE LITERATURE</p>
          <h2 id="workflow-title">
            A thought.
            <br />A connection.
            <br />
            <span>A discovery.</span>
          </h2>
          <p className="workflow-description">
            {'Research starts with curiosity. Give your next question somewhere to go.'
              .split(' ')
              .map((word, index) => (
                <span className="reveal-word" key={index}>
                  {word}{' '}
                </span>
              ))}
          </p>
        </div>
        <div className="workflow-gallery">
          {steps.map(({ title, description, Icon, example }) => (
            <article className="workflow-card" key={title}>
              <Icon className="workflow-icon" size={30} strokeWidth={1.3} />
              <h3>{title}</h3>
              <p>{description}</p>
              <div className="workflow-example">{example}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="start-section">
        <p>Your next discovery starts with a question.</p>
        <button onClick={onStart}>
          Follow it.
          <ArrowUpRight size={32} strokeWidth={1.4} />
        </button>
      </section>
    </div>
  );
}
