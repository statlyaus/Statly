# CLAUSE: Design Review Guidelines

This clause establishes the **design review standards** for Statly — an AFL Fantasy web platform.  
Our vision is to deliver a **modern, ambitious fantasy experience** that blends the best aspects of **ESPN Fantasy**, **SuperCoach**, and **Yahoo Fantasy**, while carving out a unique AFL-first identity.

---

## 1. Purpose
Design reviews ensure that Statly:
- Delivers an experience **on par with major fantasy platforms** (ESPN, SuperCoach, Yahoo).  
- Provides a **clean, data-rich interface** for serious fantasy users.  
- Stays **accessible, responsive, and performant** across all devices.  
- Aligns with the **AFL culture** and our goal of making Statly *the most trusted fantasy companion in Australia*.  

---

## 2. Design Inspirations & Benchmarks
When reviewing contributions, compare them against the following:

- **ESPN Fantasy** → strong use of data tables, tabs, and clear navigation for managing rosters and waivers.  
- **SuperCoach** → AFL-specific depth in statistics and player projections, but often cluttered — Statly should aim to **refine and simplify**.  
- **Yahoo Fantasy** → modern mobile-first design, with easy-to-use trade flows and real-time draft boards.  

Statly should combine:
- ESPN’s **structured layouts**,  
- SuperCoach’s **AFL stat depth**,  
- Yahoo’s **ease of use and visual polish**.  

---

## 3. Review Checklist

### 🎨 Visual Consistency
- [ ] Colours & typography follow Statly’s **design tokens** (inspired by AFL team branding but kept neutral).  
- [ ] Tables, cards, and dashboards use **consistent spacing and hierarchy** (like ESPN’s fantasy stat tables).  
- [ ] Draft boards and team views follow a **modern, grid-based layout** (comparable to Yahoo’s snake drafts).  
- [ ] Charts, player summaries, and projections emphasise **clarity over clutter** (avoiding SuperCoach’s noise).  

### ♿ Accessibility
- [ ] Meets **WCAG 2.1 AA** requirements.  
- [ ] Interactive controls labelled (`aria-label`, `<label>`).  
- [ ] Works fully with **keyboard navigation**.  
- [ ] Colours/contrast tested in light and dark modes.  

### 📱 Responsiveness
- [ ] Mobile-first layout: users should manage their team **as easily on phone as desktop**.  
- [ ] Real-time features (draft, live scoring) scale down gracefully on small screens.  
- [ ] No layout breakage in portrait vs. landscape.  

### ⚡ Performance
- [ ] Loads within **2 seconds** on 4G mobile.  
- [ ] Player images and logos optimised (`.webp` / `.avif`).  
- [ ] Data tables virtualised for large stat lists.  
- [ ] Lazy-loading applied to **non-critical assets**.  

### 🧪 Review Process
- [ ] PR includes **before/after screenshots or demo video**.  
- [ ] Reviewer tests layout in **Chrome, Safari, and Firefox** (desktop + mobile).  
- [ ] Reviewer runs **Lighthouse**: Accessibility ≥90, Performance ≥85.  
- [ ] Reviewer compares UX against **ESPN, SuperCoach, Yahoo** flows for parity.  

---

## 4. Approval
- Requires **maintainer sign-off** and **1 design peer reviewer**.  
- New design patterns must be added to the **Statly Design System** (docs + Figma, if applicable).  
- Breaking design changes flagged in `CHANGELOG.md`.  

---

## 5. Exceptions
- Text-only edits (copy/typo fixes) can skip formal design review.  
- Emergency hotfixes logged for follow-up review in the next sprint.  

---

✅ By adopting this CLAUSE, we commit to building Statly into a **fantasy platform that feels as polished as ESPN**, **as AFL-specific as SuperCoach**, and **as user-friendly as Yahoo Fantasy** — while remaining uniquely our own.