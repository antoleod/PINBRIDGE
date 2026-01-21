# COACH_UI_SPEC.md

## Pack Card Component

### HTML Structure
```html
<div class="pack-card glass-panel" data-pack-id="{{id}}">
    <div class="pack-header">
        <div class="pack-icon">{{icon}}</div>
        <div class="pack-meta">
            <span class="pack-type">{{type}}</span>
            <span class="pack-difficulty">{{difficulty}}</span>
        </div>
    </div>
    <h3 class="pack-title">{{title}}</h3>
    <p class="pack-subtitle">{{subtitle}}</p>
    <div class="pack-tags">
        {{#each ui_hint_tags}}
        <span class="tag">{{this}}</span>
        {{/each}}
    </div>
    <div class="pack-stats">
        <span>{{size_cards}} cards</span>
        <span>{{duration_days}} days</span>
    </div>
    <div class="pack-cta">
        {{#if installed}}
        {{#if completed}}
        <button class="btn btn-secondary" data-action="review-pack" data-pack-id="{{id}}">Review</button>
        {{else}}
        <button class="btn btn-primary" data-action="continue-pack" data-pack-id="{{id}}">Continue</button>
        {{/if}}
        {{else}}
        <button class="btn btn-primary" data-action="start-pack" data-pack-id="{{id}}">Start</button>
        {{/if}}
    </div>
</div>
```

### Copywriting Guidelines
- **Title**: Concise, e.g., "AWS SAA-C03 Core"
- **Subtitle**: Value proposition, e.g., "Daily architecture decisions with exam-style traps."
- **Badge/Type**: "Certification" or "Language"
- **Tags**: ["30-day route", "Scenarios", "Mock exams"]

### States
- **Not Started**: CTA "Start"
- **In Progress**: CTA "Continue", show progress %
- **Completed**: CTA "Review"

### Dark Mode Support
- Use CSS variables for colors (e.g., var(--text-primary))
- Glass panel class handles transparency

### Interactions
- Click CTA to start/continue/review
- Hover effects on card</content>
<parameter name="filePath">c:\Users\X1\Documents\PINBRIDGE-1\docs\COACH_UI_SPEC.md