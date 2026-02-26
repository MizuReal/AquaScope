"use client";

import { useEffect, useState } from "react";

const SHOWCASE_DURATION = 6500;

export default function ShowcaseCarousel({ slides = [] }) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (slides.length < 2) {
      return undefined;
    }
    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, SHOWCASE_DURATION);
    return () => clearInterval(timer);
  }, [slides.length]);

  if (slides.length === 0) {
    return null;
  }

  const handleNavigate = (direction) => {
    setActiveIndex((current) => {
      const next = current + direction;
      if (next < 0) {
        return slides.length - 1;
      }
      if (next >= slides.length) {
        return 0;
      }
      return next;
    });
  };

  const activeSlide = slides[activeIndex];

  return (
    <section className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 overflow-hidden">
      <div className="relative h-[420px] sm:h-[520px] lg:h-[640px] xl:h-[720px]">
        {slides.map((slide, index) => (
          <div
            key={`${slide.title}-${index}`}
            className={`absolute inset-0 transition-all duration-700 ease-out ${
              index === activeIndex ? "z-10 opacity-100 scale-100" : "pointer-events-none opacity-0 scale-105"
            }`}
          >
            <img
              src={slide.src}
              alt={slide.alt}
              className="h-full w-full object-cover"
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
            />
          </div>
        ))}

        <div
          className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-r from-[#020817] via-[#020817]/40 to-transparent"
          aria-hidden="true"
        />

        <div className="absolute inset-0 z-30 flex flex-col justify-end px-6 py-10 sm:px-12 sm:py-14">
          <div className="max-w-3xl space-y-4 text-white">
            <p className="text-xs uppercase tracking-[0.5em] text-cyan-200/80">{activeSlide.tagline}</p>
            <h2 className="text-3xl font-semibold leading-tight sm:text-4xl">{activeSlide.title}</h2>
            <p className="text-sm text-white/85 sm:text-base">{activeSlide.description}</p>
            <div className="flex flex-wrap gap-3 text-[0.7rem] uppercase tracking-[0.35em] text-white/70">
              <span className="rounded-full border border-white/40 px-4 py-2">{activeSlide.badge}</span>
              <span className="rounded-full border border-white/40 px-4 py-2">{activeSlide.location}</span>
            </div>
          </div>
        </div>

        <div className="absolute inset-y-0 left-4 z-40 hidden items-center sm:flex">
          <button
            type="button"
            aria-label="Previous showcase slide"
            className="rounded-full border border-white/30 bg-black/20 p-3 text-white backdrop-blur transition hover:border-white/60"
            onClick={() => handleNavigate(-1)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M14 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="absolute inset-y-0 right-4 z-40 hidden items-center sm:flex">
          <button
            type="button"
            aria-label="Next showcase slide"
            className="rounded-full border border-white/30 bg-black/20 p-3 text-white backdrop-blur transition hover:border-white/60"
            onClick={() => handleNavigate(1)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M10 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 gap-2">
          {slides.map((_, index) => (
            <button
              key={`showcase-indicator-${index}`}
              type="button"
              aria-label={`Go to showcase slide ${index + 1}`}
              className={`h-1.5 w-10 rounded-full transition ${
                index === activeIndex ? "bg-white" : "bg-white/30"
              }`}
              onClick={() => setActiveIndex(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
