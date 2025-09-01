# 🎨 Statly Design System & Style Guide

## 📋 **Overview**

The Statly Design System provides a comprehensive set of design tokens, components, and patterns to ensure consistency across the fantasy AFL platform. This guide serves as the single source of truth for all design and development decisions.

---

## 🎯 **Design Principles**

### **1. Consistency**

- Uniform visual language across all pages and components
- Predictable interaction patterns
- Standardized spacing and typography

### **2. Accessibility**

- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatibility
- High contrast ratios

### **3. Performance**

- Optimized component rendering
- Efficient CSS delivery
- Mobile-first responsive design

### **4. Scalability**

- Modular component architecture
- Reusable design tokens
- Extensible pattern library

---

## 🎨 **Color System**

### **Primary Palette**

```css
/* Primary Blue */
--color-primary: #3772df;
--color-primary-50: #eff6ff;
--color-primary-100: #dbeafe;
--color-primary-500: #3772df;
--color-primary-600: #2563eb;
--color-primary-700: #1d4ed8;

/* Secondary */
--color-secondary: #dee8fa;
--color-secondary-foreground: #1a49a0;
```

### **Semantic Colors**

```css
/* Success */
--color-success: #10b981;
--color-success-50: #ecfdf5;
--color-success-100: #d1fae5;

/* Warning */
--color-warning: #f59e0b;
--color-warning-50: #fffbeb;
--color-warning-100: #fef3c7;

/* Error */
--color-error: #ef4444;
--color-error-50: #fef2f2;
--color-error-100: #fee2e2;

/* Info */
--color-info: #3b82f6;
--color-info-50: #eff6ff;
--color-info-100: #dbeafe;
```

### **Neutral Palette**

```css
/* Gray Scale */
--color-gray-50: #f9fafb;
--color-gray-100: #f3f4f6;
--color-gray-200: #e5e7eb;
--color-gray-300: #d1d5db;
--color-gray-400: #9ca3af;
--color-gray-500: #6b7280;
--color-gray-600: #4b5563;
--color-gray-700: #374151;
--color-gray-800: #1f2937;
--color-gray-900: #111827;
```

---

## 📝 **Typography**

### **Font Family**

```css
font-family:
  'Inter',
  -apple-system,
  BlinkMacSystemFont,
  'Segoe UI',
  sans-serif;
```

### **Type Scale**

```css
/* Headings */
.text-xs: 12px / 16px
.text-sm: 14px / 20px
.text-base: 16px / 24px
.text-lg: 18px / 28px
.text-xl: 20px / 28px
.text-2xl: 24px / 32px
.text-3xl: 30px / 36px
.text-4xl: 36px / 40px

/* Font Weights */
.font-normal: 400
.font-medium: 500
.font-semibold: 600
.font-bold: 700
```

### **Usage Guidelines**

- **H1**: `text-3xl font-bold` - Page titles
- **H2**: `text-2xl font-semibold` - Section headers
- **H3**: `text-xl font-semibold` - Subsection headers
- **Body**: `text-sm` - Default body text
- **Caption**: `text-xs text-gray-500` - Helper text

---

## 📏 **Spacing System**

### **Base Scale**

```css
/* Tailwind spacing scale */
0: 0px
1: 4px
2: 8px
3: 12px
4: 16px
5: 20px
6: 24px
8: 32px
10: 40px
12: 48px
16: 64px
20: 80px
24: 96px
```

### **Standardized Classes**

```css
/* Container spacing */
.container-padding: px-4 sm:px-6 lg:px-8
.container-margin: mx-auto max-w-7xl
.container-full: container-margin container-padding

/* Card spacing */
.card-padding: p-4 sm:p-6
.card-padding-sm: p-3 sm:p-4
.card-padding-lg: p-6 sm:p-8

/* Form spacing */
.form-group: space-y-4
.form-row: grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6

/* Page layout */
.page-header: mb-6 lg:mb-8
.page-content: space-y-6 lg:space-y-8
```

---

## 🧩 **Component Library**

### **Button Variants**

```tsx
// Primary action
<Button variant="primary" size="md">Save Changes</Button>

// Secondary action
<Button variant="secondary" size="md">Cancel</Button>

// Destructive action
<Button variant="danger" size="md">Delete</Button>

// Subtle action
<Button variant="ghost" size="md">Learn More</Button>
```

### **Form Components**

```tsx
// Input with validation
<FormField label="Email" error={errors.email} required>
  <Input
    type="email"
    placeholder="Enter your email"
    error={!!errors.email}
  />
</FormField>

// Select dropdown
<FormField label="Position">
  <Select placeholder="Choose position">
    <option value="DEF">Defender</option>
    <option value="MID">Midfielder</option>
  </Select>
</FormField>
```

### **Data Display**

```tsx
// Responsive table
<ResponsiveTable
  data={players}
  columns={columns}
  mobileCardView={true}
  stickyHeader={true}
/>

// Status badges
<StatusBadge status="success">Active</StatusBadge>
<StatusBadge status="warning">Pending</StatusBadge>
<StatusBadge status="error">Inactive</StatusBadge>
```

---

## 📱 **Responsive Design**

### **Breakpoints**

```css
/* Mobile first approach */
sm: 640px   /* Small tablets */
md: 768px   /* Tablets */
lg: 1024px  /* Laptops */
xl: 1280px  /* Desktops */
2xl: 1536px /* Large screens */
```

### **Layout Patterns**

```tsx
// Responsive grid
<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>

// Responsive navigation
<nav className="hidden lg:flex">Desktop Nav</nav>
<nav className="lg:hidden">Mobile Nav</nav>

// Responsive table
<ResponsiveTable mobileCardView={true} />
```

---

## ♿ **Accessibility Standards**

### **Color Contrast**

- **AA Standard**: 4.5:1 for normal text
- **AA Standard**: 3:1 for large text
- **AAA Standard**: 7:1 for enhanced contrast

### **Focus Management**

```tsx
// Focus indicators
.focus:outline-none .focus:ring-2 .focus:ring-blue-500

// Focus traps in modals
<Modal>
  <FocusTrap>
    <ModalContent />
  </FocusTrap>
</Modal>
```

### **ARIA Labels**

```tsx
// Descriptive labels
<button aria-label="Close modal">×</button>

// Live regions
<div aria-live="polite" aria-atomic="true">
  Status updates
</div>

// Form associations
<label htmlFor="email">Email</label>
<input id="email" aria-describedby="email-error" />
<div id="email-error" role="alert">Error message</div>
```

---

## 🔄 **Animation & Motion**

### **Timing Functions**

```css
/* Easing curves */
--ease-in: cubic-bezier(0.4, 0, 1, 1) --ease-out: cubic-bezier(0, 0, 0.2, 1)
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1) /* Duration scale */ --duration-75: 75ms
  --duration-100: 100ms --duration-150: 150ms --duration-200: 200ms --duration-300: 300ms;
```

### **Motion Principles**

- **Respect reduced motion**: Use `prefers-reduced-motion`
- **Purposeful animation**: Enhance UX, don't distract
- **Consistent timing**: Use standard duration scale

---

## 📋 **Usage Guidelines**

### **Do's**

✅ Use standardized spacing classes  
✅ Follow color contrast guidelines  
✅ Implement proper focus management  
✅ Use semantic HTML elements  
✅ Test with screen readers  
✅ Optimize for mobile first

### **Don'ts**

❌ Use arbitrary spacing values  
❌ Override component styles inline  
❌ Ignore accessibility requirements  
❌ Create custom colors without approval  
❌ Use animations without reduced motion check  
❌ Break responsive design patterns

---

## 🛠️ **Development Workflow**

### **Component Creation**

1. Design component in Figma/design tool
2. Create TypeScript interface
3. Implement with accessibility
4. Add to Storybook/demo page
5. Write tests
6. Document usage

### **Quality Checklist**

- [ ] Responsive design tested
- [ ] Accessibility compliance verified
- [ ] Performance impact assessed
- [ ] Cross-browser compatibility checked
- [ ] Documentation updated

---

## 📚 **Resources**

### **Tools**

- **Design**: Figma design system
- **Development**: TypeScript + Tailwind CSS
- **Testing**: Vitest + Testing Library
- **Documentation**: Storybook + MDX

### **References**

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [React Accessibility](https://reactjs.org/docs/accessibility.html)

This design system ensures **consistent, accessible, and scalable** UI development across the Statly platform.
