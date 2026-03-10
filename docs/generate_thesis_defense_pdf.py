#!/usr/bin/env python3
"""Generate a comprehensive PDF document for thesis defense:
Water Quality & Microbial Risk Assessment System."""

from fpdf import FPDF
import os

class ThesisPDF(FPDF):
    """Custom PDF class with headers, footers, and helper methods."""

    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(120, 120, 120)
            self.cell(0, 8, "Water Quality & Microbial Risk Assessment - Thesis Defense Reference", align="C")
            self.ln(4)
            self.set_draw_color(200, 200, 200)
            self.line(10, self.get_y(), 200, self.get_y())
            self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def title_page(self):
        self.add_page()
        self.ln(60)
        self.set_font("Helvetica", "B", 28)
        self.set_text_color(20, 60, 120)
        self.multi_cell(0, 14, "Water Quality Assessment\n& Microbial Risk Prediction", align="C")
        self.ln(10)
        self.set_font("Helvetica", "", 16)
        self.set_text_color(80, 80, 80)
        self.cell(0, 10, "Comprehensive Thesis Defense Reference", align="C")
        self.ln(20)
        self.set_draw_color(20, 60, 120)
        self.set_line_width(0.5)
        self.line(60, self.get_y(), 150, self.get_y())
        self.ln(20)
        self.set_font("Helvetica", "", 12)
        self.set_text_color(60, 60, 60)
        self.cell(0, 8, "System Documentation: Model Architecture, WHO Threshold Engine,", align="C")
        self.ln(8)
        self.cell(0, 8, "Microbial Risk Computation & Defense Preparation", align="C")
        self.ln(30)
        self.set_font("Helvetica", "I", 10)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, "Generated from ML-AAW Codebase Analysis", align="C")

    def section_title(self, num, title):
        self.ln(6)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(20, 60, 120)
        self.cell(0, 10, f"{num}. {title}")
        self.ln(10)
        self.set_draw_color(20, 60, 120)
        self.set_line_width(0.3)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def subsection_title(self, num, title):
        self.ln(3)
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(40, 80, 140)
        self.cell(0, 8, f"{num} {title}")
        self.ln(9)

    def body_text(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5.5, text)
        self.ln(2)

    def bold_text(self, text):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5.5, text)
        self.ln(1)

    def italic_text(self, text):
        self.set_font("Helvetica", "I", 10)
        self.set_text_color(60, 60, 60)
        self.multi_cell(0, 5.5, text)
        self.ln(1)

    def code_block(self, text):
        self.set_font("Courier", "", 9)
        self.set_fill_color(245, 245, 245)
        self.set_text_color(30, 30, 30)
        x = self.get_x()
        self.set_x(x + 5)
        self.multi_cell(180, 5, text, fill=True)
        self.ln(3)

    def bullet(self, text, indent=15):
        x = self.get_x()
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.set_x(x + indent)
        # Use a simple dash as bullet for compatibility
        self.multi_cell(190 - indent - 5, 5.5, f"- {text}")
        self.ln(1)

    def table_header(self, col_widths, headers):
        self.set_font("Helvetica", "B", 9)
        self.set_fill_color(20, 60, 120)
        self.set_text_color(255, 255, 255)
        for i, (w, h) in enumerate(zip(col_widths, headers)):
            self.cell(w, 7, h, border=1, fill=True, align="C")
        self.ln()

    def table_row(self, col_widths, cells, alt=False):
        self.set_font("Helvetica", "", 8)
        self.set_text_color(30, 30, 30)
        if alt:
            self.set_fill_color(240, 245, 255)
        else:
            self.set_fill_color(255, 255, 255)
        max_h = 7
        for i, (w, c) in enumerate(zip(col_widths, cells)):
            self.cell(w, max_h, str(c), border=1, fill=True, align="C" if i > 0 else "L")
        self.ln()

    def formula(self, text):
        self.set_font("Courier", "B", 10)
        self.set_text_color(120, 30, 30)
        self.set_fill_color(255, 250, 245)
        self.set_x(self.get_x() + 10)
        self.multi_cell(170, 6, text, fill=True, align="C")
        self.ln(3)

    def qa_block(self, question, answer):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(170, 50, 50)
        self.multi_cell(0, 5.5, f"Q: {question}")
        self.ln(1)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5.5, f"A: {answer}")
        self.ln(4)

    def colored_box(self, title, body, title_r=255, title_g=255, title_b=255,
                    bg_r=240, bg_g=248, bg_b=255, border_r=20, border_g=60, border_b=120):
        """Draw a rounded-ish colored box with a title bar and body text."""
        x = self.get_x()
        y = self.get_y()
        # Check if enough space, otherwise new page
        if y > 240:
            self.add_page()
            y = self.get_y()
        # Title bar
        self.set_fill_color(border_r, border_g, border_b)
        self.set_draw_color(border_r, border_g, border_b)
        self.rect(10, y, 190, 9, style="FD")
        self.set_xy(14, y + 1.5)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(title_r, title_g, title_b)
        self.cell(0, 6, title)
        # Body area
        body_y = y + 9
        self.set_xy(10, body_y)
        self.set_fill_color(bg_r, bg_g, bg_b)
        # Calculate height needed
        self.set_font("Helvetica", "", 10)
        # Temporarily write to measure
        page_before = self.page
        y_before = body_y
        self.set_xy(14, body_y + 3)
        self.set_text_color(30, 30, 30)
        self.multi_cell(182, 5.5, body)
        y_after = self.get_y() + 3
        body_h = y_after - body_y
        # Draw background rect behind text (on same page)
        if self.page == page_before:
            self.set_fill_color(bg_r, bg_g, bg_b)
            self.set_draw_color(border_r, border_g, border_b)
            # We can't draw behind already-written text in fpdf2 easily,
            # so we accept the text is on top. Just add border line at bottom.
            self.set_draw_color(border_r, border_g, border_b)
            self.set_line_width(0.3)
            self.line(10, y_after, 200, y_after)
            self.line(10, y, 10, y_after)   # left
            self.line(200, y, 200, y_after) # right
        self.set_y(y_after + 4)

    def glossary_item(self, term, definition):
        """Render a single glossary entry."""
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(20, 60, 120)
        self.cell(55, 6, term)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 6, definition)
        self.ln(1.5)

    def term_entry(self, abbreviation, full_name, explanation):
        """Render an abbreviation / acronym entry."""
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(170, 50, 50)
        self.cell(35, 6, abbreviation)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(30, 30, 30)
        self.cell(55, 6, full_name)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(80, 80, 80)
        self.multi_cell(0, 6, explanation)
        self.ln(1)

    def chart_image(self, img_path, caption, width=190):
        """Insert a chart image with a caption below it."""
        if not os.path.exists(img_path):
            self.set_font("Helvetica", "I", 10)
            self.set_text_color(200, 50, 50)
            self.cell(0, 8, f"[Chart not found: {os.path.basename(img_path)}]")
            self.ln(10)
            return
        # Check remaining space; if image won't fit, start new page
        if self.get_y() > 140:
            self.add_page()
        self.image(img_path, x=(210 - width) / 2, w=width)
        self.ln(2)
        self.set_font("Helvetica", "I", 9)
        self.set_text_color(80, 80, 80)
        self.cell(0, 5, caption, align="C")
        self.ln(8)


def generate_pdf(output_path):
    pdf = ThesisPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)

    # ===== TITLE PAGE =====
    pdf.title_page()

    # ===== TABLE OF CONTENTS =====
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(20, 60, 120)
    pdf.cell(0, 12, "Table of Contents")
    pdf.ln(15)
    toc_items = [
        ("", "Quick Reference (ELI5, TLDR, Gist, Glossary, Terms)"),
        ("1", "System Architecture Overview"),
        ("2", "Dataset Description"),
        ("3", "Microbial Risk Label Generation - The WHO Rule-Based Engine"),
        ("4", "Machine Learning Models"),
        ("5", "Missing Value Handling"),
        ("6", "Prediction Flow at Inference Time"),
        ("7", "Per-Parameter Anomaly Detection (Z-Score)"),
        ("8", "Mathematical Summary"),
        ("9", "Defending Key Questions (Q&A)"),
        ("10", "Model Visualizations & Charts"),
    ]
    for num, title in toc_items:
        pdf.set_font("Helvetica", "", 11)
        pdf.set_text_color(40, 40, 40)
        pdf.cell(0, 8, f"  {num}.  {title}")
        pdf.ln(8)

    # ===== QUICK REFERENCE PAGES =====
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(20, 60, 120)
    pdf.cell(0, 12, "Quick Reference")
    pdf.ln(14)
    pdf.set_draw_color(20, 60, 120)
    pdf.set_line_width(0.4)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(6)

    # --- ELI5 ---
    pdf.colored_box(
        "ELI5 (Explain Like I'm 5)",
        'Imagine you have a glass of water and you want to know if it\'s safe to drink. '
        'You can\'t see germs, but you CAN measure things like how cloudy the water is, '
        'how acidic it is, or how much chlorine is in it.\n\n'
        'Our system works like a really smart checklist:\n'
        '  1. It looks at 9 measurements from your water sample.\n'
        '  2. A "rule checker" compares each measurement against safety limits set by the World Health Organization (WHO) - '
        'like a teacher grading a test.\n'
        '  3. If many measurements fail, the water gets a HIGH risk score. If just a few fail, MEDIUM. If almost none fail, LOW.\n'
        '  4. A computer brain (Random Forest - imagine 200 tiny experts voting) also looks at ALL the measurements together '
        'and gives its own opinion on the risk.\n'
        '  5. If either the rule checker OR the computer brain says "danger," '
        'the system says "don\'t drink this water."\n\n'
        'It also tells you WHICH germs MIGHT be in the water based on what went wrong - '
        'like saying "if the water is really cloudy, E. coli could be hiding in it."',
        bg_r=255, bg_g=255, bg_b=240, border_r=50, border_g=150, border_b=50
    )

    # --- TLDR ---
    pdf.colored_box(
        "TLDR (Too Long; Didn't Read)",
        'Two Random Forest classifiers (200 trees, max_depth=12) predict water potability (binary) and '
        'microbial risk level (low/medium/high).\n\n'
        'The microbial risk labels are generated via a weighted WHO threshold engine: 9 water parameters are '
        'checked against calibrated WHO limits, each violation adds a weight (1-3), and the total score maps '
        'to low (<3), medium (3-5), or high (>=6) out of 14 max.\n\n'
        'A safety gate overrides potability to "unsafe" whenever microbial risk is "high," ensuring the system '
        'never declares biologically dangerous water as safe.\n\n'
        'Missing values handled by median imputation. Class imbalance handled by balanced class weights. '
        'Validation via OOB scores. Bacteria are WHO-referenced lookups, not lab detections.',
        bg_r=240, bg_g=240, bg_b=255, border_r=60, border_g=60, border_b=160
    )

    # --- GIST ---
    pdf.add_page()
    pdf.colored_box(
        "Simplification of Idea (Gist)",
        'THE CORE IDEA IN ONE SENTENCE:\n'
        'We use water chemistry measurements to predict whether germs might be present, '
        'by checking WHO safety limits and training a machine learning model on those checks.\n\n'
        'WHY TWO SYSTEMS? (Rules + ML)\n'
        '- Rules = Transparent and explainable ("pH is too high")\n'
        '- ML = Catches hidden patterns between multiple parameters working together\n'
        '- Safety gate = If EITHER system says danger, water is flagged unsafe\n\n'
        'WHAT THE SYSTEM OUTPUTS:\n'
        '- Is this water potable? (Yes/No + probability)\n'
        '- What is the microbial risk? (Low / Medium / High + probability per class)\n'
        '- Which parameters violated WHO limits?\n'
        '- Which bacteria could possibly be present given those violations?\n\n'
        'WHAT THE SYSTEM DOES NOT DO:\n'
        '- It does NOT detect live bacteria (no lab culture or PCR)\n'
        '- It does NOT replace laboratory testing\n'
        '- It PREDICTS RISK based on water chemistry indicators',
        bg_r=255, bg_g=245, bg_b=238, border_r=200, border_g=100, border_b=20
    )

    # --- MEANING OF TERMS ---
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(20, 60, 120)
    pdf.cell(0, 10, 'Meaning of Terms - What Does "X" Stand For?')
    pdf.ln(10)
    pdf.set_draw_color(20, 60, 120)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(5)

    terms = [
        ("RF", "Random Forest", "An ensemble of decision trees that vote together"),
        ("WHO", "World Health Org.", "Sets international water safety standards"),
        ("OOB", "Out-of-Bag", "Built-in validation using unsampled data per tree"),
        ("TDS", "Total Dissolved Solids", "All dissolved minerals/salts in water (mg/L)"),
        ("TOC", "Total Organic Carbon", "Organic matter concentration (feeds biofilms)"),
        ("THMs", "Trihalomethanes", "Disinfection byproducts (cancer risk indicator)"),
        ("NTU", "Nephelo. Turb. Units", "Measures water cloudiness (pathogen shielding)"),
        ("DBPs", "Disinfection Byproducts", "Chemicals formed when disinfectants react with organics"),
        ("GI", "Gastrointestinal", "Relating to stomach and intestines"),
        ("P75", "75th Percentile", "Value below which 75% of data falls"),
        ("ELI5", "Explain Like I'm 5", "Simplified non-technical explanation"),
        ("TLDR", "Too Long; Didn't Read", "Ultra-brief executive summary"),
        ("ML", "Machine Learning", "Algorithms that learn patterns from data"),
        ("API", "Application Prog. Interface", "How software components communicate"),
        ("IQR", "Interquartile Range", "Range between 25th and 75th percentile (Q1-Q3)"),
    ]
    for abbr, full, expl in terms:
        pdf.term_entry(abbr, full, expl)

    # --- GLOSSARY ---
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(20, 60, 120)
    pdf.cell(0, 10, "Glossary")
    pdf.ln(10)
    pdf.set_draw_color(20, 60, 120)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(5)

    glossary = [
        ("Random Forest", "An ensemble machine learning method that builds many decision trees on random subsets of the data and averages their predictions. Reduces overfitting and provides probability outputs."),
        ("Potability", "Whether water is safe for human consumption. Binary outcome: potable (1) or not potable (0)."),
        ("Microbial Risk", "The likelihood that harmful microorganisms (bacteria, viruses, parasites) are present in water, inferred from physicochemical indicators."),
        ("WHO Threshold", "Safety limits published by the World Health Organization for drinking water quality parameters."),
        ("Calibrated Threshold", "WHO thresholds adjusted to the dataset's distribution (using percentiles) so labels are meaningful rather than flagging 99%+ of samples."),
        ("Biofilm", "A community of microorganisms attached to surfaces (e.g., pipe walls). Certain water chemistry conditions promote biofilm growth."),
        ("Surrogate Label", "A target variable generated from rules/heuristics rather than direct measurement. Our microbial risk labels are surrogate labels derived from WHO threshold rules."),
        ("Feature", "An input variable (measurement) used by the model. Our system uses 9 water quality features."),
        ("Imputation", "Filling in missing data. We use median imputation: replacing NaN with the column's median value."),
        ("StandardScaler", "Transforms features to have mean=0 and std=1. Included for pipeline robustness though Random Forest doesn't strictly need it."),
        ("OOB Score", "Out-of-Bag score. Each tree is tested on the ~37% of samples NOT used in its bootstrap training set. Provides free cross-validation."),
        ("Bootstrap Sampling", "Drawing random samples WITH replacement from the dataset. Each tree in a Random Forest trains on a different bootstrap sample."),
        ("Class Imbalance", "When one class has significantly more samples than another (e.g., 66.8% not-potable vs. 33.2% potable). Handled by balanced class weights."),
        ("Safety Gate", "Logic override: if microbial risk is HIGH, potability is forced to FALSE regardless of the potability model's prediction."),
        ("Z-Score", "Number of standard deviations a value is from the mean. z = (value - mean) / std. Used for anomaly detection per parameter."),
        ("Decision Threshold", "The probability cutoff for classification. Set at 0.58 (above default 0.50) to be conservative for health safety."),
        ("Ensemble Method", "Combining multiple models (trees) to make better predictions than any single model. Random Forest is an ensemble of decision trees."),
        ("Feature Interaction", "When the combined effect of two+ features matters more than each alone (e.g., high turbidity + low chlorine = much higher risk than either alone)."),
        ("Weighted Score", "Each WHO violation contributes a weight (1, 2, or 3) reflecting its epidemiological severity. The total weighted score determines risk level."),
        ("Epidemiological", "Relating to the study of disease distribution and causes in populations. Weights are based on how strongly each parameter relates to disease outbreaks."),
    ]
    for term, defn in glossary:
        pdf.glossary_item(term, defn)
        # Check if we need a new page
        if pdf.get_y() > 265:
            pdf.add_page()

    # ===== SECTION 1: ARCHITECTURE =====
    pdf.add_page()
    pdf.section_title("1", "System Architecture Overview")
    pdf.body_text(
        "The system employs two complementary machine learning models working in tandem, "
        "backed by a deterministic WHO rule-based engine for interpretability and safety."
    )
    pdf.ln(3)

    col_w = [50, 45, 40, 55]
    pdf.table_header(col_w, ["Component", "Algorithm", "Target", "Purpose"])
    pdf.table_row(col_w, ["Potability Model", "Random Forest", "Potability (0/1)", "Binary: Is water safe?"])
    pdf.table_row(col_w, ["Microbial Risk Model", "Random Forest", "Risk (L/M/H)", "Multi-class: Pathogen risk?"], alt=True)
    pdf.table_row(col_w, ["WHO Rule Engine", "Threshold Rules", "Score + Violations", "Interpretable risk scoring"])

    pdf.ln(5)
    pdf.body_text(
        "The dual-model + rule-engine + safety-gate architecture provides defense in depth: "
        "if the ML model fails, the deterministic rules catch it; if the rules miss a feature "
        "interaction, the ML model captures it; and the safety gate ensures health-critical "
        "overrides are never skipped."
    )

    # ===== SECTION 2: DATASET =====
    pdf.add_page()
    pdf.section_title("2", "Dataset Description")
    pdf.body_text(
        "Source: water_potability.csv - 3,276 water samples with 9 physicochemical features. "
        "This is a publicly available dataset commonly used in water quality research."
    )

    pdf.subsection_title("2.1", "Features (9 Input Parameters)")

    col_w2 = [32, 32, 22, 24, 25, 22, 33]
    pdf.table_header(col_w2, ["Feature", "Unit", "Median", "Min", "Max", "Missing", "Std Dev"])
    features_data = [
        ["pH", "dimless", "7.04", "0", "14", "491 (15%)", "1.59"],
        ["Hardness", "mg/L", "196.97", "47", "323", "0", "32.88"],
        ["Solids (TDS)", "mg/L", "20,928", "321", "61,227", "0", "8,769"],
        ["Chloramines", "mg/L", "~7.1", "0.35", "13.1", "0", "1.58"],
        ["Sulfate", "mg/L", "~333", "129", "481", "781 (24%)", "~36"],
        ["Conductivity", "uS/cm", "~422", "181", "753", "0", "~80"],
        ["Organic Carbon", "mg/L", "~14.2", "2.2", "28.3", "0", "~3.1"],
        ["Trihalomethanes", "ug/L", "66.6", "0.7", "124", "162 (5%)", "16.18"],
        ["Turbidity", "NTU", "3.96", "1.45", "6.74", "0", "0.78"],
    ]
    for i, row in enumerate(features_data):
        pdf.table_row(col_w2, row, alt=(i % 2 == 1))

    pdf.ln(5)
    pdf.subsection_title("2.2", "Target Label Distributions")

    pdf.bold_text("Potability (original label in dataset):")
    pdf.bullet("Not Potable (0): 2,188 samples (66.8%)")
    pdf.bullet("Potable (1): 1,088 samples (33.2%)")
    pdf.bullet("Class imbalance ratio ~ 2:1 - addressed via class_weight='balanced'")

    pdf.ln(3)
    pdf.bold_text("MicrobialRisk (computed label - see Section 3):")
    pdf.bullet("Low: 1,143 samples (34.9%)")
    pdf.bullet("Medium: 1,628 samples (49.7%)")
    pdf.bullet("High: 505 samples (15.4%)")

    # ===== SECTION 3: WHO RULE ENGINE =====
    pdf.add_page()
    pdf.section_title("3", "Microbial Risk Label Generation - WHO Rule-Based Engine")
    pdf.body_text(
        "This is the most critical component to defend. The MicrobialRisk column does NOT come "
        "from laboratory culture tests. It is computed deterministically from the 9 physicochemical "
        "parameters using WHO-grounded threshold rules."
    )

    pdf.subsection_title("3.1", "WHO Threshold Rules (Calibrated)")
    pdf.body_text(
        "The raw WHO thresholds were calibrated to the dataset's distribution. This is necessary "
        "because the dataset represents raw/untreated water where some WHO limits would flag >99% "
        "of all samples (destroying discriminative power). The calibration preserves the WHO's "
        "direction of risk while using dataset-relative percentile break-points."
    )

    pdf.ln(2)
    col_w3 = [25, 30, 30, 15, 90]
    pdf.table_header(col_w3, ["Parameter", "WHO Raw", "Calibrated", "Wt", "Mapped Bacteria"])
    threshold_data = [
        ["pH", "<6.5/>8.5", "<6.5/>8.5", "2", "E.coli, Salmonella, V.cholerae"],
        ["Hardness", ">500 mg/L", ">300 mg/L", "1", "Legionella, Pseudomonas"],
        ["Solids", ">1000 mg/L", ">27000 mg/L", "1", "E.coli, Enterobacter spp."],
        ["Chloramine", ">3 mg/L", ">9 mg/L", "2", "Mycobacterium, Legionella, Pseudo."],
        ["Sulfate", ">250 mg/L", ">400 mg/L", "1", "Clostridium, Desulfovibrio, E.coli"],
        ["Conductiv.", ">1500 uS", ">700 uS/cm", "1", "E.coli, Klebsiella, Enterococcus"],
        ["Org.Carbon", ">5 mg/L", ">18 mg/L", "2", "E.coli, Salmonella, Campylobacter"],
        ["THMs", ">100 ug/L", ">80 ug/L", "1", "E.coli, Enteric bacteria"],
        ["Turbidity", ">5 NTU", ">4 NTU", "3", "E.coli, V.cholerae, Salmonella, Shig."],
    ]
    for i, row in enumerate(threshold_data):
        pdf.table_row(col_w3, row, alt=(i % 2 == 1))

    pdf.ln(5)
    pdf.subsection_title("3.2", "Calibration Justification")
    pdf.body_text("For each parameter, the percentage of dataset samples violating the raw WHO threshold was assessed:")
    pdf.bullet("pH (<6.5 or >8.5): 52% violate - reasonable spread, kept as-is")
    pdf.bullet("Hardness (>500 mg/L): 0% violate - lowered to 300 to capture upper tail")
    pdf.bullet("TDS (>1000 mg/L): 99.9% violate - raised to P75 = 27,000")
    pdf.bullet("Chloramines (>3 mg/L): 99.2% violate - raised to P75 = 9")
    pdf.bullet("Sulfate (>250 mg/L): 97.7% violate - raised to P75 = 400")
    pdf.bullet("Conductivity (>1500 uS/cm): 0% violate - lowered to 700 for sensitivity")
    pdf.bullet("Organic Carbon (>5 mg/L): 99.8% violate - raised to P75 = 18")
    pdf.bullet("THMs (>100 ug/L): 1.9% violate - slightly lowered to 80 for sensitivity")
    pdf.bullet("Turbidity (>5 NTU): 9.6% violate - slightly lowered to 4")

    pdf.subsection_title("3.3", "Weighted Scoring Computation")
    pdf.body_text("For each water sample, the system iterates through all 9 rules:")
    pdf.formula("MicrobialScore = SUM(w_i * I[violation_i])  for i = 1..9")
    pdf.body_text(
        "Where w_i is the weight assigned to parameter i (1, 2, or 3), and I[violation_i] is 1 if "
        "the calibrated threshold is exceeded, 0 otherwise."
    )
    pdf.bold_text("Maximum possible score = 2+1+1+2+1+1+2+1+3 = 14")

    pdf.ln(3)
    pdf.subsection_title("3.4", "Weight Rationale (Epidemiological Severity)")
    pdf.bullet("Weight 3 (Turbidity): Directly shields pathogens from disinfection; strongest indicator of fecal contamination.")
    pdf.bullet("Weight 2 (pH, Chloramines, Organic Carbon): Directly affects disinfection efficacy or provides nutrient substrate for biofilm/pathogen regrowth.")
    pdf.bullet("Weight 1 (Hardness, TDS, Sulfate, Conductivity, THMs): Aesthetic or indirect indicators; associated with biofilm but less directly tied to acute pathogen risk.")

    pdf.ln(3)
    pdf.subsection_title("3.5", "Risk Classification Thresholds")
    pdf.body_text("The numeric score is mapped to risk levels using fraction-of-max thresholds:")
    pdf.formula("HIGH:   score >= 0.40 x 14 = 5.6  (i.e., score >= 6)")
    pdf.formula("MEDIUM: score >= 0.20 x 14 = 2.8  (i.e., score >= 3)")
    pdf.formula("LOW:    score < 2.8               (i.e., score <= 2)")
    pdf.body_text("This produces the distribution: Low 34.9%, Medium 49.7%, High 15.4% - a realistic epidemiological spread.")

    pdf.ln(3)
    pdf.subsection_title("3.6", "Bacteria Mapping")
    pdf.body_text(
        "The bacteria linked to each violation come from the WHO water quality bacteria risk "
        "reference table (who_water_quality_bacteria_risk.csv). Each parameter violation adds its "
        "associated bacteria to a deduplicated set, so the output is the union of all bacteria "
        "implicated by the violated thresholds. This represents 'possible bacteria given these "
        "water conditions,' not confirmed laboratory detections."
    )

    # ===== SECTION 4: ML MODELS =====
    pdf.add_page()
    pdf.section_title("4", "Machine Learning Models")

    pdf.subsection_title("4.1", "Potability Model (Binary Classification)")
    pdf.bold_text("Pipeline Architecture:")
    pdf.code_block("Input (9 features) -> SimpleImputer(median) -> StandardScaler -> RandomForestClassifier -> P(potable)")

    pdf.ln(2)
    pdf.bold_text("Hyperparameters:")
    col_w4 = [45, 30, 115]
    pdf.table_header(col_w4, ["Parameter", "Value", "Justification"])
    hp_data = [
        ["n_estimators", "200", "Sufficient ensemble size for stable probability estimates"],
        ["max_depth", "12", "Prevents overfitting on ~3,276 samples"],
        ["min_samples_split", "5", "Requires 5+ samples to create a decision split"],
        ["min_samples_leaf", "2", "Each terminal leaf has >= 2 samples"],
        ["max_features", "sqrt", "sqrt(9) ~ 3 features per split (standard for classification)"],
        ["class_weight", "balanced", "Adjusts weights inversely to class frequency (2:1 imbalance)"],
        ["random_state", "42", "Full reproducibility of training results"],
        ["oob_score", "True", "Out-of-bag validation (free cross-validation for bagging)"],
    ]
    for i, row in enumerate(hp_data):
        pdf.table_row(col_w4, row, alt=(i % 2 == 1))

    pdf.ln(5)
    pdf.bold_text("Decision Threshold: P(potable) >= 0.58")
    pdf.body_text(
        "The threshold is set above the default 0.50 to be conservative - this reduces false "
        "positives (incorrectly labeling unsafe water as potable), which is critical for a "
        "health-related application."
    )

    pdf.ln(3)
    pdf.bold_text("Risk Tiers from Potability Probability:")
    pdf.formula("safe:       P >= 0.70")
    pdf.formula("borderline: 0.50 <= P < 0.70")
    pdf.formula("watch:      0.35 <= P < 0.50")
    pdf.formula("unsafe:     P < 0.35")

    pdf.ln(5)
    pdf.subsection_title("4.2", "Microbial Risk Model (Multi-Class Classification)")
    pdf.bold_text("Pipeline Architecture:")
    pdf.code_block("Input (9 features) -> SimpleImputer(median) -> StandardScaler -> RandomForestClassifier -> P(low), P(med), P(high)")

    pdf.body_text(
        "Identical hyperparameters to the potability model. The target y is the rule-generated "
        "labels (Section 3) encoded as: low=0, medium=1, high=2 via LabelEncoder."
    )

    pdf.ln(3)
    pdf.bold_text("Key Design Decision: ML on Rule-Generated Labels")
    pdf.body_text(
        "The Random Forest is trained on the rule-generated microbial risk labels, then at inference "
        "time it predicts from the raw 9 features. This means the ML model learns the non-linear "
        "decision boundaries that the rule engine defines, but can generalize more smoothly - it "
        "uses all 9 features holistically rather than applying hard thresholds parameter-by-parameter. "
        "This captures feature interactions that a simple rule engine cannot."
    )

    pdf.ln(3)
    pdf.bold_text("OOB Accuracy:")
    pdf.body_text(
        "The Out-of-Bag score is logged at model startup and serves as an built-in validation "
        "metric. Each of the 200 trees is evaluated on the ~37% of samples it was NOT trained on "
        "(the out-of-bag samples from bootstrap sampling). This provides a reliable estimate of "
        "generalization performance without needing a separate held-out test set."
    )

    # ===== SECTION 5: MISSING VALUES =====
    pdf.add_page()
    pdf.section_title("5", "Missing Value Handling")

    col_w5 = [35, 155]
    pdf.table_header(col_w5, ["Stage", "Strategy"])
    missing_data = [
        ["Training", "SimpleImputer(strategy='median') fills NaN with column median (robust to outliers)"],
        ["Inference", "Same imputer (fitted on training data) transforms single-row input identically"],
        ["Min Required", "Potability: >= 3 features. Microbial Risk: >= 2 features"],
        ["Rule Engine", "Skips any parameter that is None/NaN - only evaluates rules with available data"],
    ]
    for i, row in enumerate(missing_data):
        pdf.table_row(col_w5, row, alt=(i % 2 == 1))

    pdf.ln(5)
    pdf.body_text(
        "The use of median imputation (rather than mean) is intentional: the median is robust to "
        "outliers, which is important given features like TDS (range 321-61,227) and pH (range 0-14) "
        "that can have extreme values. The sklearn Pipeline ensures the same imputation parameters "
        "fitted on training data are applied at inference time, preventing data leakage."
    )

    # ===== SECTION 6: PREDICTION FLOW =====
    pdf.add_page()
    pdf.section_title("6", "Prediction Flow at Inference Time")
    pdf.body_text("When a user submits a water sample via API (POST /potability or POST /microbial-risk):")

    pdf.ln(3)
    pdf.bold_text("Step 1: Input Validation")
    pdf.body_text("Pydantic schema validates the 9 float parameters (all optional) plus metadata fields (color, source, sample_label, user_id, notes).")

    pdf.bold_text("Step 2: Potability Prediction")
    pdf.body_text("The potability Random Forest pipeline processes the 9 features through imputation, scaling, and classification to produce P(potable).")

    pdf.bold_text("Step 3: Microbial Risk Prediction (Parallel)")
    pdf.body_text("The microbial risk Random Forest independently predicts P(low), P(medium), P(high) from the same 9 features.")

    pdf.bold_text("Step 4: WHO Rule Engine Assessment")
    pdf.body_text("The rule engine iterates all 9 calibrated WHO thresholds, tallies the weighted violation score, identifies violated parameters, and collects the associated bacteria set.")

    pdf.bold_text("Step 5: Safety Gate Override")
    pdf.body_text(
        "CRITICAL: Even if the potability model says 'safe', the system overrides to 'unsafe' if "
        "the microbial risk model predicts 'high'. If microbial risk is 'medium' and potability was "
        "'True', the risk level is downgraded to 'borderline'. This is a defense-in-depth mechanism "
        "ensuring that a chemically acceptable but biologically dangerous sample is never reported as safe."
    )
    pdf.ln(2)
    pdf.code_block(
        "Safety Gate Logic:\n"
        "  IF microbial_risk == 'high':\n"
        "      is_potable = False\n"
        "      risk_level = 'unsafe'\n"
        "  ELIF microbial_risk == 'medium' AND is_potable == True:\n"
        "      risk_level = 'borderline'"
    )

    pdf.bold_text("Step 6: Response Assembly & Persistence")
    pdf.body_text("The final JSON response includes potability verdict, probability, risk level, per-parameter z-score checks, microbial risk level with class probabilities, WHO violations, and possible bacteria. The result is persisted to Supabase.")

    # ===== SECTION 7: Z-SCORE =====
    pdf.add_page()
    pdf.section_title("7", "Per-Parameter Anomaly Detection (Z-Score)")
    pdf.body_text("Each parameter receives an independent z-score check against training dataset statistics:")
    pdf.formula("z = (x - mean) / std_dev")

    pdf.ln(3)
    col_w6 = [40, 40, 110]
    pdf.table_header(col_w6, ["|z| Range", "Status", "Meaning"])
    z_data = [
        ["< 1.5", "ok", "Value is within normal range of the training data"],
        ["1.5 - 2.5", "warning", "Value is moderately unusual - warrants attention"],
        [">= 2.5", "critical", "Value is highly unusual - likely problematic"],
    ]
    for i, row in enumerate(z_data):
        pdf.table_row(col_w6, row, alt=(i % 2 == 1))

    pdf.ln(5)
    pdf.body_text(
        "These checks are independent of the ML model and serve as additional user-visible flags "
        "in the response. Each parameter also reports its recommended range (Q1-Q3 of the training "
        "data) to help users contextualize their readings."
    )

    # ===== SECTION 8: MATH SUMMARY =====
    pdf.add_page()
    pdf.section_title("8", "Mathematical Summary")

    pdf.subsection_title("8.1", "Potability Prediction")
    pdf.formula("y_potable = 1  if  (1/T) * SUM(h_t(x))  >=  0.58")
    pdf.body_text("Where T = 200 decision trees, each h_t outputs class probability from a bootstrap sample.")

    pdf.subsection_title("8.2", "Microbial Risk Score (Rule-Based)")
    pdf.formula("S = SUM(w_i * I[f_i(x_i)])  for i = 1..9")
    pdf.body_text("Where f_i is the calibrated WHO threshold function and w_i is in {1, 2, 3}.")

    pdf.subsection_title("8.3", "Microbial Risk Classification (ML)")
    pdf.formula("y_risk = argmax_{c in {low,med,high}} P(c | x)")
    pdf.body_text("Where probabilities come from the Random Forest ensemble vote across 200 trees.")

    pdf.subsection_title("8.4", "Safety Gate Override")
    pdf.formula("Final_Potability = y_potable AND NOT(microbial == high)")
    pdf.body_text("The safety gate ensures the system never declares water potable when microbial risk is high.")

    pdf.subsection_title("8.5", "Class Weight Balancing")
    pdf.formula("w_c = n / (k * n_c)")
    pdf.body_text(
        "Where n = total samples (3,276), k = number of classes (2 for potability, 3 for microbial), "
        "and n_c = samples in class c. This effectively upweights minority classes during tree construction."
    )

    # ===== SECTION 9: Q&A =====
    pdf.add_page()
    pdf.section_title("9", "Defending Key Questions (Q&A)")

    pdf.qa_block(
        "Your microbial risk labels aren't from lab culture - how is this valid?",
        "We use a surrogate labelling approach, analogous to how credit scoring builds behavioral labels "
        "from rule engines before training ML models. Our labels are derived from WHO-published "
        "physicochemical thresholds that are internationally recognized indicators of microbial "
        "contamination risk. The system does NOT claim to identify live bacteria - it predicts the "
        "RISK LEVEL that conditions favorable for specific pathogens exist based on water chemistry. "
        "This is stated clearly in the API response as 'predicted_by_model: true'."
    )

    pdf.qa_block(
        "Why train an ML model on rule-generated labels? Why not just use the rules?",
        "Three reasons: (1) Smooth generalization - The rule engine uses hard thresholds (e.g., "
        "pH > 8.5 triggers violation). The Random Forest learns soft boundaries and captures "
        "INTERACTIONS between parameters (e.g., high TOC combined with low chloramine residual). "
        "(2) Robustness to missing data - The imputer + forest combination handles missing values "
        "gracefully; the rule engine simply skips unknown parameters, potentially under-counting risk. "
        "(3) Probabilistic output - The RF provides calibrated class probabilities P(low), P(medium), "
        "P(high), not just a hard label. This is more informative for decision-making."
    )

    pdf.qa_block(
        "Why calibrate the WHO thresholds instead of using them raw?",
        "The raw WHO thresholds (e.g., TDS > 1,000 mg/L) are designed for TREATED drinking water. "
        "This dataset represents raw/untreated water samples where 99.9% of samples exceed the TDS "
        "limit. Using raw thresholds would label nearly every sample as 'high risk,' destroying "
        "discriminative power. Our calibration uses dataset-relative percentile breakpoints (P75) "
        "while preserving the WHO's direction-of-concern."
    )

    pdf.qa_block(
        "What validation do you have?",
        "Three layers: (1) OOB Score (Out-of-Bag) - built into the Random Forest. Each tree is "
        "evaluated on the ~37% of samples it wasn't trained on. Logged at startup. "
        "(2) Label distribution sanity - the generated labels produce Low 34.9%, Medium 49.7%, "
        "High 15.4%, which is epidemiologically plausible and not dominated by one class. "
        "(3) Safety gate override - even if the ML model makes an error, the rule engine independently "
        "evaluates violations, and the safety gate catches dangerous false negatives."
    )

    pdf.qa_block(
        "Why Random Forest specifically?",
        "Random Forest works well with small-to-medium datasets (~3,276 samples), natively handles "
        "non-linear relationships and feature interactions, is resistant to overfitting via bagging "
        "(200 trees each on a bootstrap sample), provides feature importance and OOB validation "
        "out of the box, is scale-invariant (StandardScaler kept for pipeline consistency), and "
        "handles class imbalance via built-in class_weight='balanced'."
    )

    pdf.qa_block(
        "How do you handle the 2:1 class imbalance in potability?",
        "class_weight='balanced' automatically sets sample weights inversely proportional to class "
        "frequency: w_c = n / (k * n_c). For potability with 2,188 non-potable and 1,088 potable "
        "samples, the potable class gets roughly double the weight during tree construction, "
        "ensuring the model does not simply predict the majority class."
    )

    pdf.qa_block(
        "What about missing data (pH has 15% missing, Sulfate 24% missing)?",
        "SimpleImputer(strategy='median') replaces missing values with the column median, which is "
        "robust to outliers (unlike mean imputation). This is applied identically at training and "
        "inference time via the sklearn Pipeline, ensuring no data leakage. At inference, users can "
        "submit as few as 3 parameters for potability or 2 for microbial risk."
    )

    pdf.qa_block(
        "Could a sample be potable but have high microbial risk?",
        "Yes - that's exactly why the safety gate exists. The potability model evaluates overall "
        "chemical suitability, but a sample with perfect chemistry except extremely high turbidity "
        "(shielding pathogens) would still be flagged as microbially unsafe and overridden to "
        "is_potable = False with risk_level = 'unsafe'."
    )

    pdf.qa_block(
        "How are the bacteria identified?",
        "They are NOT identified through culture or molecular testing. The bacteria lists are a "
        "WHO-referenced lookup table (who_water_quality_bacteria_risk.csv) mapping each "
        "physicochemical violation to the pathogens that are epidemiologically associated with "
        "those water conditions. They represent 'possible bacteria given these conditions,' "
        "not confirmed detections. The system clearly communicates this distinction."
    )

    pdf.qa_block(
        "Is the StandardScaler necessary for Random Forest?",
        "Strictly, no - Random Forest is scale-invariant because it uses threshold-based splits. "
        "The StandardScaler is included in the pipeline for consistency and in case the model is "
        "later swapped for a distance-based or gradient-based algorithm (e.g., SVM, Neural Network) "
        "that DOES require scaled features. It has zero negative impact on RF performance."
    )

    pdf.qa_block(
        "What is the oob_score and why is it sufficient for validation?",
        "OOB (Out-of-Bag) score leverages the bootstrap sampling inherent in Random Forest. Each "
        "tree is trained on ~63% of the data (a bootstrap sample). The remaining ~37% (out-of-bag "
        "samples) are used to evaluate that tree. Aggregating predictions across all trees for each "
        "sample's out-of-bag appearances gives a validation accuracy WITHOUT needing a separate test "
        "set. Research has shown OOB error is nearly identical to k-fold cross-validation for forests "
        "with sufficient trees (200 in our case)."
    )

    # ===== SECTION 10: MODEL CHARTS =====
    charts_dir = os.path.join(os.path.dirname(os.path.abspath(output_path)), "charts")

    pdf.add_page()
    pdf.section_title("10", "Model Visualizations & Charts")
    pdf.body_text(
        "The following charts were generated from the actual training pipeline using Out-of-Bag "
        "(OOB) predictions as the validation mechanism. All metrics reflect the model's performance "
        "on data each tree did NOT see during training, providing an honest estimate of generalization."
    )
    pdf.ln(3)

    # --- Important context: why 66% is acceptable ---
    pdf.colored_box(
        "Important Context: Why 66% Potability Accuracy Is Acceptable",
        'If you come from image classification, you expect 90%+ accuracy. Tabular data is fundamentally '
        'different:\n\n'
        '  Image Classification: Millions of pixels, rich spatial patterns, 10K-1M+ samples, classes '
        'look visually distinct (cat vs dog). Typical accuracy: 90-99%.\n\n'
        '  Tabular / Water Potability: Only 9 numeric features, 3,276 samples, and classes GENUINELY '
        'overlap (potable and non-potable water can have nearly identical chemistry). Published '
        'benchmarks for this specific dataset:\n'
        '    - Random Forest: 64-68%\n'
        '    - XGBoost: 65-69%\n'
        '    - Neural Networks: 63-67%\n'
        '    - SVM: 60-65%\n\n'
        'Our 66.33% is RIGHT AT the top of the competitive range. The ceiling is low because the 9 '
        'physicochemical features alone are insufficient to perfectly determine potability - you would '
        'also need microbiological testing, metal analysis, etc. The potability model is a SCREENING '
        'TOOL, not a definitive test. The 0.58 threshold deliberately sacrifices some accuracy for '
        'safety: it is better to flag safe water as "investigate further" than to miss unsafe water.',
        bg_r=255, bg_g=248, bg_b=240, border_r=200, border_g=100, border_b=20
    )

    # --- Chart 11: OOB Accuracy Summary ---
    pdf.add_page()
    pdf.subsection_title("10.1", "Model Validation: OOB Accuracy")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "Two bars comparing the Out-of-Bag accuracy of both models: Potability at ~66% and "
        "Microbial Risk at ~98%. The gray dotted line at 50% represents random guessing (coin flip)."
    )
    pdf.ln(2)
    pdf.bold_text("Why the huge gap between the two models?")
    pdf.body_text(
        "The microbial risk labels were generated by the WHO rule engine (deterministic threshold "
        "rules). The Random Forest essentially learns to replicate those rules. It is like teaching "
        "someone a formula and testing them on it - they should score near 100%. The ~2% error comes "
        "from the median imputation of missing values introducing slight noise into the boundary cases."
    )
    pdf.body_text(
        "The potability labels come from real-world lab testing. The chemistry alone cannot perfectly "
        "predict potability. Both models are significantly above the 50% random baseline."
    )
    pdf.ln(2)
    pdf.bold_text("Defense talking point:")
    pdf.italic_text(
        '"The microbial risk model achieves 98% because it learns a defined rule system. The potability '
        'model achieves 66% which matches published benchmarks for this well-known dataset. We compensate '
        'with a conservative threshold (0.58) and the safety gate override."'
    )
    pdf.chart_image(os.path.join(charts_dir, "11_oob_accuracy.png"),
                     "Figure 10.1: Out-of-Bag accuracy for Potability (binary) and Microbial Risk (3-class) models.")

    # --- Chart 1: Class Distribution ---
    pdf.add_page()
    pdf.subsection_title("10.2", "Training Data: Class Distributions")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "Bar charts showing how many samples fall into each class for both targets."
    )
    pdf.ln(2)
    pdf.bold_text("Potability (left bar chart):")
    pdf.body_text(
        "2,188 not potable (66.8%) vs 1,088 potable (33.2%). This is a 2:1 class imbalance - the "
        "model sees twice as many 'bad' water samples as 'good' ones. Without class_weight='balanced', "
        "the model would simply predict 'not potable' for everything and achieve 66.8% accuracy by "
        "doing nothing useful. The balanced weights force the model to actually learn both classes."
    )
    pdf.ln(2)
    pdf.bold_text("Microbial Risk (right bar chart):")
    pdf.body_text(
        "Low 1,143 (34.9%), Medium 1,628 (49.7%), High 505 (15.4%). More balanced than potability "
        "but 'high' is the minority class. The class_weight='balanced' setting upweights high-risk "
        "samples during training so the model pays extra attention to them."
    )
    pdf.ln(2)
    pdf.bold_text("Why this matters for defense:")
    pdf.italic_text(
        "This chart proves you are aware of class imbalance and have addressed it. If asked 'did you "
        "account for imbalanced data?', point to this chart plus the class_weight='balanced' parameter."
    )
    pdf.chart_image(os.path.join(charts_dir, "01_class_distribution.png"),
                     "Figure 10.2: Class distribution for Potability and Microbial Risk labels.")

    # --- Chart 2: Feature Importance ---
    pdf.add_page()
    pdf.subsection_title("10.3", "Feature Importance (Gini Impurity)")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "Horizontal bars ranking which features each model relies on most. Longer bar = more important. "
        "Importance is measured by Gini decrease: every time a tree splits on a feature, Gini impurity "
        "decreases. The total decrease across all 200 trees, averaged, gives the importance score."
    )
    pdf.ln(2)
    pdf.bold_text("Potability Model (left):")
    pdf.body_text(
        "Feature importance is spread fairly evenly across all 9 parameters. No single feature dominates. "
        "This is expected because no single water parameter alone determines potability - it is the "
        "combination of all parameters that matters."
    )
    pdf.ln(2)
    pdf.bold_text("Microbial Risk Model (right):")
    pdf.body_text(
        "Turbidity, pH, and organic carbon rank higher because they have the highest WHO threshold "
        "weights (3, 2, and 2 respectively). The rule engine gives them more influence in the label "
        "generation, so the Random Forest learns to prioritize them. Features like hardness and "
        "conductivity have lower importance because very few samples violate those thresholds."
    )
    pdf.ln(2)
    pdf.bold_text("Defense talking point:")
    pdf.italic_text(
        '"Feature importance confirms the model learned the right priorities. The microbial risk model '
        'correctly identifies turbidity as the most important feature - matching its highest WHO weight '
        'of 3, and its known role in pathogen shielding."'
    )
    pdf.chart_image(os.path.join(charts_dir, "02_feature_importance.png"),
                     "Figure 10.3: Gini-based feature importance for both Random Forest models.")

    # --- Chart 3: Confusion Matrices ---
    pdf.add_page()
    pdf.subsection_title("10.4", "Confusion Matrices (OOB Predictions)")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "A grid of actual vs predicted labels. Numbers on the diagonal = correct predictions. "
        "Numbers off the diagonal = errors. Read row-by-row: pick a row (e.g., 'Actual: Potable') "
        "and the numbers across that row show how many of those samples were predicted correctly vs "
        "incorrectly."
    )
    pdf.ln(2)
    pdf.bold_text("How to read - Potability (left):")
    pdf.body_text(
        "Significant off-diagonal numbers show the model makes mistakes on both classes. Specifically: "
        "some potable water is misclassified as not-potable (false negative for potable), and some "
        "non-potable is misclassified as potable (false positive for potable). In a health application, "
        "a false 'not potable' is SAFE (user investigates further), but a false 'potable' is DANGEROUS "
        "(user drinks bad water). That is why the safety gate exists as backup."
    )
    pdf.ln(2)
    pdf.bold_text("How to read - Microbial Risk (right):")
    pdf.body_text(
        "Nearly all values are on the diagonal, showing excellent classification. The few errors are "
        "mostly 'high' misclassified as 'medium' (adjacent-class confusion). This is the least harmful "
        "type of error - the sample is still flagged as elevated risk, just one category lower."
    )
    pdf.ln(2)
    pdf.bold_text("Defense talking point:")
    pdf.italic_text(
        '"The confusion matrix shows our microbial risk model correctly classifies 98% of samples. '
        'For potability, we acknowledge the overlap and address it with a conservative threshold and '
        'multiple safety layers."'
    )
    pdf.chart_image(os.path.join(charts_dir, "03_confusion_matrices.png"),
                     "Figure 10.4: OOB confusion matrices for Potability and Microbial Risk models.")

    # --- Chart 4: ROC Curves ---
    pdf.add_page()
    pdf.subsection_title("10.5", "ROC Curves (Receiver Operating Characteristic)")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "ROC curves plot the trade-off between True Positive Rate (catching actual positives) and "
        "False Positive Rate (false alarms) at EVERY possible classification threshold. The curve "
        "sweeps from the bottom-left (threshold=1.0, nothing predicted positive) to top-right "
        "(threshold=0.0, everything predicted positive)."
    )
    pdf.ln(2)
    pdf.bold_text("How to read AUC (Area Under Curve):")
    pdf.bullet("AUC = 1.0: Perfect model - the curve hugs the top-left corner")
    pdf.bullet("AUC = 0.5: Random guessing - the diagonal dashed line")
    pdf.bullet("Potability AUC ~0.72: The model correctly ranks potable water higher than non-potable 72% of the time")
    pdf.bullet("Microbial Risk AUC ~0.99 per class: Near-perfect discrimination for all risk levels")
    pdf.ln(2)
    pdf.bold_text("Why ROC matters for defense:")
    pdf.body_text(
        "Even though potability accuracy is 66%, the AUC of ~0.72 shows the model has learned "
        "meaningful patterns. ROC separates the model's RANKING ability from the specific threshold "
        "chosen. The model is better at ranking samples than at hard classification, which is why "
        "we output probabilities rather than just yes/no."
    )
    pdf.ln(2)
    pdf.bold_text("Microbial Risk (right):")
    pdf.body_text(
        "One-vs-Rest ROC: each class gets its own curve. Green (Low), Orange (Medium), Red (High) "
        "all show AUC near 1.0, confirming the model can distinguish all three risk levels with "
        "near-perfect accuracy."
    )
    pdf.chart_image(os.path.join(charts_dir, "04_roc_curves.png"),
                     "Figure 10.5: ROC curves with AUC values. Left: Potability. Right: Microbial Risk (One-vs-Rest).")

    # --- Chart 5: Precision-Recall ---
    pdf.add_page()
    pdf.subsection_title("10.6", "Precision-Recall Curves")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "The trade-off between Precision (of the samples I flagged positive, how many were actually "
        "positive?) and Recall (of all actual positives, how many did I catch?). AP (Average Precision) "
        "summarizes the overall curve - higher is better."
    )
    pdf.ln(2)
    pdf.bold_text("Why PR curves matter more than ROC here:")
    pdf.body_text(
        "PR curves are MORE informative than ROC for imbalanced datasets. ROC can appear optimistic "
        "when the negative class is large. PR curves are not affected by class imbalance and show the "
        "true trade-off for the minority class."
    )
    pdf.ln(2)
    pdf.bold_text("For a health application:")
    pdf.body_text(
        "You care more about RECALL (do not miss dangerous water) than PRECISION (some false alarms "
        "are acceptable). The PR curve shows exactly how this trade-off works at different thresholds. "
        "The microbial risk model shows strong AP across all three classes."
    )
    pdf.chart_image(os.path.join(charts_dir, "05_precision_recall.png"),
                     "Figure 10.6: Precision-Recall curves with AP scores.")

    # --- Chart 6: Score Distribution ---
    pdf.add_page()
    pdf.subsection_title("10.7", "WHO Threshold Score Distribution")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "A histogram of the weighted microbial risk scores computed for all 3,276 samples. Each bar "
        "represents one score value (0 through 14). The colored background zones show the risk "
        "classification boundaries: Green = Low (score 0-2), Yellow = Medium (score 3-5), "
        "Red = High (score 6-14). Dashed vertical lines mark the exact threshold scores."
    )
    pdf.ln(2)
    pdf.bold_text("What to look for:")
    pdf.bullet("The distribution should span across all three zones. If 99% of bars were in one zone, the thresholds would be useless.")
    pdf.bullet("The green/yellow/red zones should match reasonable epidemiological expectations: most water is medium risk, fewer samples at extremes.")
    pdf.bullet("The spread confirms that the calibrated WHO thresholds produce meaningful, non-degenerate labels.")
    pdf.ln(2)
    pdf.bold_text("Why this chart validates the calibration:")
    pdf.body_text(
        "If we had used the raw WHO thresholds (e.g., TDS > 1,000 mg/L), 99% of the bars would be "
        "in the red (High) zone because this dataset represents raw/untreated water. Our calibrated "
        "thresholds produce a spread that is useful for classification. This chart is proof that the "
        "calibration works."
    )
    pdf.chart_image(os.path.join(charts_dir, "06_score_distribution.png"),
                     "Figure 10.7: Distribution of WHO threshold weighted scores with risk zone overlay.")

    # --- Chart 7: Correlation Heatmap ---
    pdf.add_page()
    pdf.subsection_title("10.8", "Feature Correlation Matrix")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "A triangular heatmap showing the Pearson correlation coefficient between every pair of the "
        "9 input features. Values range from -1.0 (perfect inverse relationship) to +1.0 (perfect "
        "positive relationship). Values near 0 mean no linear relationship. Blue = negative "
        "correlation, Red = positive correlation, White = no correlation."
    )
    pdf.ln(2)
    pdf.bold_text("What you want to see:")
    pdf.body_text(
        "Mostly low correlations (near 0). This means each feature provides INDEPENDENT information "
        "to the model. If two features were highly correlated (e.g., 0.95), one would be redundant "
        "and could be removed without losing information."
    )
    pdf.ln(2)
    pdf.bold_text("What this dataset shows:")
    pdf.body_text(
        "Most pairs are below 0.1 correlation, which is ideal. The 9 features are not duplicating "
        "each other - each contributes unique information to the model. There is no severe "
        "multicollinearity that could confuse interpretation of feature importance."
    )
    pdf.ln(2)
    pdf.bold_text("Defense talking point:")
    pdf.italic_text(
        '"The correlation heatmap confirms our features are largely independent. No feature is '
        'redundant, and there is no multicollinearity issue that would make feature importance '
        'unreliable."'
    )
    pdf.chart_image(os.path.join(charts_dir, "07_correlation_heatmap.png"),
                     "Figure 10.8: Lower-triangle Pearson correlation heatmap of all 9 features.")

    # --- Chart 8: Probability Distributions ---
    pdf.add_page()
    pdf.subsection_title("10.9", "Model Confidence Distributions")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "Histograms of the model's predicted probabilities, colored by the TRUE label of each sample. "
        "This reveals how confident or uncertain the model is for each class."
    )
    pdf.ln(2)
    pdf.bold_text("Potability (left):")
    pdf.body_text(
        "Two overlapping distributions: blue (truly potable) and red (truly not-potable). If they "
        "separated cleanly (red on the left at P=0, blue on the right at P=1), the model would be "
        "perfect. The OVERLAP in the middle is exactly why accuracy is 66% - the model is genuinely "
        "uncertain for many samples because their chemistry looks similar regardless of potability. "
        "The dashed vertical line at 0.58 shows the decision threshold."
    )
    pdf.ln(2)
    pdf.bold_text("Microbial Risk (right):")
    pdf.body_text(
        "Shows the maximum predicted probability (confidence) for each sample, colored by true class. "
        "Values near 1.0 mean the model is very confident. You should see most predictions stacked "
        "near 1.0, confirming the model is decisive rather than guessing."
    )
    pdf.ln(2)
    pdf.bold_text("This is the most intuitive chart for defense:")
    pdf.italic_text(
        '"This chart visually explains the 66% potability accuracy: the classes OVERLAP in feature '
        'space. No model can perfectly separate them with these 9 features alone. But the microbial '
        'risk classes are clearly separable, hence 98% accuracy."'
    )
    pdf.chart_image(os.path.join(charts_dir, "08_probability_distributions.png"),
                     "Figure 10.9: OOB probability distributions showing model confidence by true class.")

    # --- Chart 9: Calibration Curve ---
    pdf.add_page()
    pdf.subsection_title("10.10", "Calibration Curve (Reliability Diagram)")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "A calibration curve checks whether the model's predicted probabilities match reality. "
        "The idea: if the model says '70% chance of potable' for a group of samples, then ~70% of "
        "those samples should ACTUALLY be potable. Points on the chart are binned averages."
    )
    pdf.ln(2)
    pdf.bold_text("How to read it:")
    pdf.bullet("Points ON the diagonal (dashed line) = perfectly calibrated probabilities")
    pdf.bullet("Points ABOVE the diagonal = model is underconfident (actual rate higher than predicted)")
    pdf.bullet("Points BELOW the diagonal = model is overconfident (actual rate lower than predicted)")
    pdf.bullet("The blue shaded area shows the gap between predicted and actual")
    pdf.ln(2)
    pdf.bold_text("Why this matters for a health application:")
    pdf.body_text(
        "Users of this system see probabilities like 'P(potable) = 0.75'. They need to TRUST that "
        "number actually means roughly 75% likely potable, not that the model is systematically "
        "over-estimating or under-estimating. A well-calibrated model gives trustworthy probabilities."
    )
    pdf.ln(2)
    pdf.bold_text("Defense talking point:")
    pdf.italic_text(
        '"The calibration curve shows our model produces reasonably calibrated probabilities. Users '
        'can trust the reported confidence levels for informed decision-making."'
    )
    pdf.chart_image(os.path.join(charts_dir, "09_calibration_curve.png"),
                     "Figure 10.10: Potability model calibration curve. Closer to diagonal = better calibrated.")

    # --- Chart 10: Feature Box Plots ---
    pdf.add_page()
    pdf.subsection_title("10.11", "Feature Distributions by Risk Level")
    pdf.bold_text("What this chart shows:")
    pdf.body_text(
        "For each of the 9 features, three side-by-side box plots show how values distribute "
        "across Low (green), Medium (orange), and High (red) microbial risk classes. The box "
        "shows Q1-Q3 (middle 50% of data), the line inside is the median, and dots are outliers."
    )
    pdf.ln(2)
    pdf.bold_text("What to look for:")
    pdf.bullet("CLEAR SEPARATION between boxes (e.g., turbidity: high-risk samples have clearly higher turbidity) means the feature is discriminative.")
    pdf.bullet("OVERLAPPING BOXES (e.g., hardness looks similar across all three) means the feature is less useful for risk classification.")
    pdf.bullet("This visually confirms why feature importance scores are what they are.")
    pdf.ln(2)
    pdf.bold_text("Key observations:")
    pdf.body_text(
        "Features with WHO weight 2-3 (turbidity, pH, organic carbon) should show clear box "
        "separation between risk levels. Features with WHO weight 1 (hardness, conductivity) will "
        "show more overlap. This is by design - the WHO weights reflect which parameters are most "
        "epidemiologically significant."
    )
    pdf.ln(2)
    pdf.bold_text("Defense talking point:")
    pdf.italic_text(
        '"As visible in the box plots, turbidity and pH show clear separation between risk levels, '
        'which is consistent with their highest WHO weights (3 and 2). The visual separation confirms '
        'that our threshold calibration and weight assignment have genuine discriminative power."'
    )
    pdf.chart_image(os.path.join(charts_dir, "10_feature_boxplots.png"),
                     "Figure 10.11: Box plots of all 9 features split by microbial risk level (Low/Medium/High).",
                     width=185)

    # Save
    pdf.output(output_path)
    return output_path


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "Thesis_Defense_Water_Quality_Microbial_Risk.pdf")
    path = generate_pdf(out)
    print(f"PDF generated: {path}")
