"use client";

import { useEffect, useState } from "react";

const SLIDE_DURATION = 5500;

export default function HeroCarousel({ slides = [] }) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (slides.length < 2) {
      return undefined;
    }

    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, SLIDE_DURATION);

    return () => clearInterval(timer);
  }, [slides.length]);

  if (slides.length === 0) {
    return null;
  }

  const currentSlide = slides[activeIndex];

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

  return (
    <div className="hero-glow relative">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[32px] border border-white/10 bg-[#050c1f] shadow-2xl">
        {slides.map((slide, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              key={`${slide.title}-${index}`}
              className={`absolute inset-0 transition-all duration-700 ease-out ${
                isActive ? "z-10 opacity-100 scale-100" : "pointer-events-none opacity-0 scale-105"
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
          );
        })}

        <div
          className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent"
          aria-hidden="true"
        />

        <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-4 px-6 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">
                {currentSlide.badge}
              </p>
              <p className="text-2xl font-semibold text-white">
                {currentSlide.title}
              </p>
            </div>
            <div className="flex -space-x-5 text-right">
              <div className="rounded-full bg-white/10 px-4 py-3 text-left">
                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/70">
                  Risk Score
                </p>
                <p className="text-lg font-semibold text-lime-200">
                  {currentSlide.risk}
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm text-slate-200/90">{currentSlide.caption}</p>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-2">
              {slides.map((_, index) => (
                <span
                  key={`indicator-${index}`}
                  className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/15"
                >
                  <span
                    className={`absolute inset-y-0 left-0 rounded-full bg-cyan-300 transition-all duration-500 ${
                      index === activeIndex ? "w-full opacity-100" : "w-0 opacity-0"
                    }`}
                  />
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous slide"
                className="rounded-full border border-white/20 bg-white/10 p-2 text-white backdrop-blur"
                onClick={() => handleNavigate(-1)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Next slide"
                className="rounded-full border border-white/20 bg-white/10 p-2 text-white backdrop-blur"
                onClick={() => handleNavigate(1)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
