"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Navigation from "@/components/Navigation";

/* ── Scroll-reveal hook ───────────────────────────────────── */
function useScrollReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* If already visible on mount (e.g. above the fold), reveal immediately */
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      el.classList.add("revealed");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -30px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/* Parallax hook for background scrolling effect */
function useParallax(speed = 0.5) {
  const ref = useRef(null);
  
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    
    const handleScroll = () => {
      const rect = el.getBoundingClientRect();
      const scrolled = window.pageYOffset;
      const rate = scrolled * speed;
      el.style.transform = `translateY(${rate}px)`;
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [speed]);
  
  return ref;
}

/* wrapper component so we can reuse the hook per-section */
function Reveal({ children, className = "", delay = 0, direction = "up" }) {
  const ref = useScrollReveal();
  const dirClass =
    direction === "left"
      ? "scroll-reveal-left"
      : direction === "right"
        ? "scroll-reveal-right"
        : "scroll-reveal";
  return (
    <div
      ref={ref}
      className={`${dirClass} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* Parallax background component */
function ParallaxBackground({ speed = -0.3 }) {
  const parallaxRef = useParallax(speed);
  
  return (
    <div 
      ref={parallaxRef}
      className="absolute bg-cover bg-center"
      style={{
        backgroundImage: `linear-gradient(rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.25)), url('https://images.pexels.com/photos/918642/pexels-photo-918642.jpeg')`,
        willChange: 'transform',
        top: '-500px',
        left: '0',
        right: '0',
        bottom: '-500px',
        minHeight: '200vh',
      }}
    />
  );
}

/* ── Supabase storage base URL (public bucket) ────────────── */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const storageUrl = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public` : "";

/* ── Wide Carousel — what the system does ─────────────────── */
const carouselSlides = [
  {
    type: "video",
    src: `${storageUrl}/Video/Man_Drinking_Water.mp4`,
    alt: "Clean drinking water",
    title: "Safe Water, Verified by AI",
    description:
      "AquaScope ensures every glass of water is backed by machine learning predictions, WHO-standard checks, and real-time microbial risk grading.",
    accent: "sky",
  },
  {
    type: "image",
    src: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=1400&q=80",
    alt: "Person scanning a paper form and digitizing it",
    title: "OCR Form Scanning",
    description:
      "Point your camera at a standardized data card. Fiducial markers auto-align the image and our OCR engine extracts all water quality parameters in under 6 seconds.",
    accent: "sky",
  },
  {
    src: "https://images.unsplash.com/photo-1576086213369-97a306d36557?w=1400&q=80",
    type: "image",
    alt: "Water sample being tested in a laboratory",
    title: "ML Potability Prediction",
    description:
      "Submit pH, turbidity, chloramines and 6 more parameters. Our gradient-boosted model evaluates potability against WHO standards and returns an explainable risk score.",
    accent: "emerald",
  },
  {
    src: "https://images.unsplash.com/photo-1579154204601-01588f351e67?w=1400&q=80",
    type: "image",
    alt: "Microscopic view of bacteria in water",
    title: "Microbial Risk Grading",
    description:
      "Bacteria colony counts are mapped to WHO risk categories. The system identifies specific organisms, checks threshold violations, and provides color-coded safety indicators.",
    accent: "amber",
  },
  {
    src: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1400&q=80",
    type: "image",
    alt: "AI chatbot interface on a screen",
    title: "AI Chat Assistant",
    description:
      "Ask questions about your results in plain language. Powered by Groq's Llama 3.3 70B, the chatbot explains anomalies, suggests filtration methods, and generates compliance summaries.",
    accent: "violet",
  },
  {
    src: "https://images.unsplash.com/photo-1523362628745-0c100150b504?w=1400&q=80",
    type: "image",
    alt: "Water container inspection for moss presence detection",
    title: "Moss Detection in Water Containers",
    description:
      "Scan a water container image and let the model detect whether moss is present. The system flags moss contamination risk quickly to support field screening and follow-up action.",
    accent: "rose",
  },
];

const carouselTextAccents = {
  sky: "text-sky-300",
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  violet: "text-violet-300",
  rose: "text-rose-300",
};

/* ── Steps ────────────────────────────────────────────────── */
const steps = [
  {
    number: "01",
    title: "Capture & Digitize",
    description:
      "Scan handwritten lab forms, field photos, and sensor readings using your phone or tablet. Our OCR engine auto-aligns fiducial markers, extracts every field, and validates entries — all in under 6 seconds.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
      </svg>
    ),
    color: "bg-sky-50 text-sky-600 border-sky-200",
    accent: "text-sky-600",
  },
  {
    number: "02",
    title: "ML Analysis",
    description:
      "Multiple machine learning models — computer vision, gradient boosting, and graph networks — analyze your water sample data simultaneously. Every prediction includes feature-level explanations so you know exactly what's driving the result.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
    color: "bg-emerald-50 text-emerald-600 border-emerald-200",
    accent: "text-emerald-600",
  },
  {
    number: "03",
    title: "Risk Prediction",
    description:
      "Our potability classifier cross-references WHO guidelines to produce a safety score, while the microbial risk engine grades bacterial contamination from historical and real-time data. Results are explained in plain language.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
    color: "bg-amber-50 text-amber-600 border-amber-200",
    accent: "text-amber-600",
  },
  {
    number: "04",
    title: "AI-Powered Insights",
    description:
      "An integrated LLM chatbot interprets your results in context — explain anomalies, suggest next steps, compare against historical baselines, and generate compliance-ready summaries, all through natural conversation.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
      </svg>
    ),
    color: "bg-violet-50 text-violet-600 border-violet-200",
    accent: "text-violet-600",
  },
];

/* ── Features ─────────────────────────────────────────────── */
const features = [
  {
    title: "OCR Form Scanning",
    description:
      "Fiducial-marker alignment auto-extracts handwritten lab data from paper forms into structured fields.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75h6.879a2.25 2.25 0 0 1 1.591.659l3.621 3.621a2.25 2.25 0 0 1 .659 1.591V18a2.25 2.25 0 0 1-2.25 2.25h-10.5A2.25 2.25 0 0 1 5.25 18V6a2.25 2.25 0 0 1 2.25-2.25Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 3.75V8.25h4.5" />
      </svg>
    ),
    iconColor: "border-sky-200 bg-sky-50 text-sky-600",
  },
  {
    title: "Potability Prediction",
    description:
      "Gradient-boosted model evaluates pH, hardness, chloramines, and 6 more parameters against WHO standards.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.75v4.5l-4.25 7.735A3 3 0 0 0 8.129 20.25h7.742a3 3 0 0 0 2.629-4.265L14.25 8.25v-4.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 12.75h7.5" />
      </svg>
    ),
    iconColor: "border-emerald-200 bg-emerald-50 text-emerald-600",
  },
  {
    title: "Microbial Risk Grading",
    description:
      "Bacteria colony counts are mapped to WHO risk categories with color-coded safety indicators.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="7" r="1" />
        <circle cx="16.5" cy="12" r="1" />
        <circle cx="12" cy="17" r="1" />
        <circle cx="7.5" cy="12" r="1" />
      </svg>
    ),
    iconColor: "border-amber-200 bg-amber-50 text-amber-600",
  },
  {
    title: "LLM Chat Assistant",
    description:
      "Ask questions about your results in plain language. Powered by Groq for fast, contextual responses.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9M7.5 12h6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v6a2.25 2.25 0 0 1-2.25 2.25H11.25L7.5 18.75V15H6.75A2.25 2.25 0 0 1 4.5 12.75v-6Z" />
      </svg>
    ),
    iconColor: "border-violet-200 bg-violet-50 text-violet-600",
  },
  {
    title: "Supabase Integration",
    description:
      "All samples, predictions, and user data stored securely with row-level security and real-time sync.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="5.25" y="10.5" width="13.5" height="9" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 10.5V8.25a3.75 3.75 0 1 1 7.5 0v2.25" />
      </svg>
    ),
    iconColor: "border-slate-300 bg-slate-100 text-slate-700",
  },
  {
    title: "Cross-Platform Access",
    description:
      "Web dashboard and React Native mobile app share the same backend — analyze anywhere, anytime.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="7.5" y="2.25" width="9" height="19.5" rx="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 5.25h3" />
        <circle cx="12" cy="18" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    ),
    iconColor: "border-rose-200 bg-rose-50 text-rose-600",
  },
];

/* ── Stats ────────────────────────────────────────────────── */
const stats = [
  { label: "Parameters analyzed", value: "9+" },
  { label: "Prediction accuracy", value: "94%" },
  { label: "OCR extraction time", value: "<6s" },
  { label: "Risk categories", value: "4" },
];

const tickerLabels = [
  { label: "WHO Guidelines", color: "text-amber-400", dot: "bg-amber-400" },
  { label: "Supabase", color: "text-emerald-400", dot: "bg-emerald-400" },
  { label: "Groq AI", color: "text-violet-400", dot: "bg-violet-400" },
  { label: "React Native", color: "text-sky-400", dot: "bg-sky-400" },
  { label: "Next.js", color: "text-indigo-300", dot: "bg-indigo-300" },
  { label: "FastAPI", color: "text-rose-400", dot: "bg-rose-400" },
];

/* ══════════════════════════════════════════════════════════════
   Image Carousel Component
   ══════════════════════════════════════════════════════════════ */
function ImageCarousel() {
  const [current, setCurrent] = useState(0);
  const len = carouselSlides.length;

  const next = useCallback(() => setCurrent((c) => (c + 1) % len), [len]);
  const prev = useCallback(() => setCurrent((c) => (c - 1 + len) % len), [len]);

  /* auto‑advance */
  useEffect(() => {
    const id = setInterval(next, 6000);
    return () => clearInterval(id);
  }, [next]);

  const slide = carouselSlides[current];

  return (
    <div className="carousel-root relative overflow-hidden bg-white">
      {/* media (image or video) */}
      <div className="relative h-[400px] w-full sm:h-[500px] lg:h-[600px]">
        {carouselSlides.map((s, i) =>
          s.type === "video" ? (
            <video
              key={i}
              src={s.src}
              autoPlay
              muted
              loop
              playsInline
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
                i === current ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            />
          ) : (
            <img
              key={i}
              src={s.src}
              alt={s.alt}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
                i === current ? "opacity-100" : "opacity-0"
              }`}
            />
          ),
        )}
        {/* gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

        {/* text overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-8 sm:p-12">
          <h3 className="text-4xl font-extrabold tracking-tight text-white drop-shadow-lg sm:text-5xl lg:text-6xl">{slide.title}</h3>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-white/90 drop-shadow-md sm:text-lg">
            {slide.description}
          </p>
        </div>
      </div>

      {/* controls */}
      <div className="mx-auto flex max-w-6xl items-center justify-between bg-white px-6 py-5">
        <div className="flex gap-2.5">
          {carouselSlides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-2.5 rounded-full transition-all duration-300 ${
                i === current ? "w-10 bg-gradient-to-r from-sky-600 to-sky-500 shadow-md shadow-sky-600/30" : "w-2.5 bg-slate-300 hover:bg-sky-400"
              }`}
            />
          ))}
        </div>
        <div className="flex gap-3">
          <button
            onClick={prev}
            aria-label="Previous slide"
            className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-600 hover:shadow-md"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            onClick={next}
            aria-label="Next slide"
            className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-600 hover:shadow-md"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Home Page
   ══════════════════════════════════════════════════════════════ */
export default function Home() {
  return (
    <>
      <Navigation />
      <main className="space-y-0">
        {/* ── Wide Image Carousel — edge-to-edge ────────────── */}
        <section className="bg-white">
          <ImageCarousel />
        </section>

        {/* ── Hero ──────────────────────────────────────────── */}
        <section className="hero-section px-6 pb-24 pt-20 lg:pb-32 lg:pt-28">
          <div className="relative z-10 mx-auto max-w-6xl">
            <div className="grid items-center gap-16 lg:grid-cols-2">
              <Reveal direction="left"><div className="space-y-10">
                <span className="inline-flex items-center gap-2.5 rounded-full border-2 border-sky-500 bg-gradient-to-r from-sky-600 to-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-sky-600/30">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  AI-Powered Water Safety
                </span>
                <h1 className="text-5xl font-bold leading-[1.15] tracking-tight text-slate-900 md:text-6xl lg:text-7xl">
                  Predict water safety{" "}
                  <span className="bg-gradient-to-r from-sky-600 via-sky-500 to-cyan-500 bg-clip-text text-transparent">before</span> the risk arrives.
                </h1>
                <p className="max-w-xl text-xl leading-relaxed text-slate-600">
                  AquaScope combines computer vision, machine learning, and AI chat to help labs,
                  field teams, and researchers analyze water quality faster and more accurately.
                </p>
                <div className="flex flex-wrap gap-5">
                  <a
                    href="#about"
                    className="group relative overflow-hidden rounded-full bg-gradient-to-r from-sky-600 to-sky-500 px-8 py-4 font-semibold text-white shadow-xl shadow-sky-600/30 transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-sky-600/40"
                  >
                    <span className="relative z-10">Learn how it works</span>
                    <div className="absolute inset-0 -z-0 bg-gradient-to-r from-sky-700 to-sky-600 opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                  <a
                    href="#features"
                    className="group rounded-full border-2 border-slate-300 bg-white px-8 py-4 font-semibold text-slate-700 shadow-md transition-all hover:-translate-y-1 hover:border-sky-400 hover:bg-slate-50 hover:shadow-lg"
                  >
                    View features
                  </a>
                </div>
              </div></Reveal>

              <Reveal direction="right" delay={200}><div className="grid grid-cols-2 gap-5">
                {stats.map((stat, idx) => (
                  <div
                    key={stat.label}
                    className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-7 shadow-lg transition-all hover:-translate-y-2 hover:shadow-2xl"
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-gradient-to-br from-sky-100 to-cyan-50 opacity-50 blur-2xl transition-all group-hover:scale-150" />
                    <p className="relative text-4xl font-extrabold bg-gradient-to-br from-sky-600 to-cyan-600 bg-clip-text text-transparent">{stat.value}</p>
                    <p className="relative mt-2 text-sm font-medium text-slate-600">{stat.label}</p>
                  </div>
                ))}
              </div></Reveal>
            </div>
          </div>
        </section>

        {/* ── Trusted-by marquee ─────────────────────────────── */}
        <section className="border-y border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 py-6">
          <div className="overflow-hidden">
            <div className="ticker-track whitespace-nowrap text-sm font-bold uppercase tracking-[0.3em] text-slate-400">
              {[...tickerLabels, ...tickerLabels].map((item, i) => (
                <span key={`${item.label}-${i}`} className={`inline-flex items-center gap-4 pr-8 ${item.color} transition-colors hover:text-sky-600`}>
                  {item.label}
                  <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── About with Large Parallax Water Background ─────────────────────────────────────────── */}
        <section id="about" className="relative overflow-hidden bg-white px-6 py-24 lg:py-32">
          {/* Large Parallax Water Background covering entire section */}
          <ParallaxBackground speed={-0.15} />
          
          <div className="relative z-10 mx-auto max-w-6xl">
            <Reveal><div className="mx-auto max-w-3xl text-center">
              <span className="mx-auto inline-flex items-center rounded-full border-2 border-sky-500 bg-gradient-to-r from-sky-600 to-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-sky-600/30">
                About AquaScope
              </span>
              <h2 className="mt-8 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl drop-shadow-[0_2px_10px_rgba(255,255,255,0.8)]">
                What does this system do?
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-slate-900 drop-shadow-[0_2px_8px_rgba(255,255,255,0.8)] font-semibold">
                AquaScope is an end-to-end water quality intelligence platform. It takes raw water
                sample data — whether from paper forms, mobile input, or sensors — and transforms it
                into actionable safety predictions using machine learning. The system scans physical
                lab forms via OCR, runs potability predictions against WHO standards, grades microbial
                contamination risk, and provides an AI chatbot to help interpret results in plain
                language. Everything is stored securely and accessible from both web and mobile.
              </p>

              {/* App Store / Play Store callout */}
              <div className="mt-10 flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
                <div className="group rounded-3xl border border-slate-200 bg-white/80 backdrop-blur-md p-6 shadow-lg transition-all hover:-translate-y-1 hover:shadow-xl hover:bg-white/90">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                      </svg>
                    </span>
                    <div className="text-left">
                      <p className="text-base font-bold text-slate-900">Available on Mobile</p>
                      <p className="text-sm text-slate-500">
                        App Store &amp; Play Store
                      </p>
                    </div>
                  </div>
                </div>
                <div className="group rounded-3xl border border-slate-200 bg-white/80 backdrop-blur-md p-6 shadow-lg transition-all hover:-translate-y-1 hover:shadow-xl hover:bg-white/90">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" />
                      </svg>
                    </span>
                    <div className="text-left">
                      <p className="text-base font-bold text-slate-900">Web Dashboard</p>
                      <p className="text-sm text-slate-500">
                        Any browser, no install
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div></Reveal>

            {/* How It Works */}
            <div className="mt-20 space-y-4">
              <Reveal><p className="text-center text-sm font-bold uppercase tracking-[0.25em] text-slate-900 drop-shadow-[0_2px_10px_rgba(255,255,255,0.8)]">
                How it works — step by step
              </p></Reveal>
              <div className="mt-10 grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-4">
                {steps.map((step, i) => (
                  <Reveal key={step.number} delay={i * 120} className="h-full"><article className="step-card flex h-full flex-col bg-white/85 p-8 backdrop-blur-md shadow-xl">
                    <div className="flex items-center justify-between">
                      <div
                        className={`flex h-16 w-16 items-center justify-center rounded-2xl border-2 ${step.color} shadow-md`}
                      >
                        {step.icon}
                      </div>
                      <span className={`text-4xl font-black ${step.accent} opacity-20`}>
                        {step.number}
                      </span>
                    </div>
                    <h3 className="mt-6 text-xl font-bold text-slate-900">{step.title}</h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">
                      {step.description}
                    </p>
                  </article></Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────── */}
        <section id="features" className="bg-gradient-to-b from-slate-50 to-white px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-6xl">
            <Reveal><div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="space-y-4">
                <span className="inline-flex items-center rounded-full border-2 border-sky-500 bg-gradient-to-r from-sky-600 to-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-sky-600/30">
                  Platform capabilities
                </span>
                <h2 className="text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
                  Everything you need for water analysis
                </h2>
              </div>
              <p className="max-w-md text-lg text-slate-600">
                From rapid OCR to AI chat, every tool is designed to make water quality analysis
                faster and more reliable.
              </p>
            </div></Reveal>
            <div className="mt-16 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {features.map((card, i) => (
                <Reveal key={card.title} delay={i * 100}><article className="feature-card group relative p-8">
                  <span className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl border-2 ${card.iconColor} shadow-md transition-all group-hover:scale-110 group-hover:shadow-lg`}>
                    {card.icon}
                  </span>
                  <h3 className="relative z-10 mt-5 text-xl font-bold text-slate-900">{card.title}</h3>
                  <p className="relative z-10 mt-3 text-sm leading-relaxed text-slate-600">{card.description}</p>
                </article></Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA — Light mode ──────────────────────────────── */}
        <Reveal><section className="px-6 py-24">
          <div className="cta-section-light mx-auto max-w-6xl rounded-[2rem] border-2 border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-12 shadow-2xl md:p-20">
            <div className="flex flex-col items-center gap-10 text-center md:flex-row md:justify-between md:text-left">
              <div className="space-y-5">
                <h3 className="text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
                  Ready to analyze your water samples?
                </h3>
                <p className="max-w-xl text-lg leading-relaxed text-slate-600">
                  Sign up to start scanning forms, running predictions, and chatting with our AI — all
                  from your browser or mobile device.
                </p>
              </div>
              <div className="flex flex-shrink-0 flex-col gap-4 sm:flex-row">
                <a
                  href="#"
                  className="group relative overflow-hidden rounded-full bg-gradient-to-r from-sky-600 to-sky-500 px-8 py-4 font-semibold text-white shadow-xl shadow-sky-600/30 transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-sky-600/40"
                >
                  <span className="relative z-10">Get started free</span>
                  <div className="absolute inset-0 -z-0 bg-gradient-to-r from-sky-700 to-sky-600 opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
                <a
                  href="#about"
                  className="rounded-full border-2 border-slate-300 bg-white px-8 py-4 font-semibold text-slate-700 shadow-md transition-all hover:-translate-y-1 hover:border-sky-400 hover:bg-slate-50 hover:shadow-lg"
                >
                  Learn more
                </a>
              </div>
            </div>
          </div>
        </section></Reveal>

        {/* ── Footer ────────────────────────────────────────── */}
        <footer className="border-t border-slate-200 bg-gradient-to-b from-white to-slate-50 px-6 py-12">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 text-sm text-slate-500 md:flex-row">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-md">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              </div>
              <span className="text-lg font-bold tracking-[0.2em] text-slate-900">AQUASCOPE</span>
            </div>
            <p>&copy; {new Date().getFullYear()} AquaScope Intelligence. All rights reserved.</p>
          </div>
        </footer>
      </main>
    </>
  );
}
