from __future__ import annotations

import base64
import html
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()


class ExportMetric(BaseModel):
    label: str
    value: str


class ExportChart(BaseModel):
    title: str
    subtitle: str = ""
    insight: str = ""
    data: List[Dict[str, Any]] = Field(default_factory=list)
    layout: Dict[str, Any] = Field(default_factory=dict)
    metrics: List[ExportMetric] = Field(default_factory=list)


class AnalyticsExportRequest(BaseModel):
    reportTitle: str = "Analytics Report"
    generatedAt: str = ""
    summaryBadges: List[str] = Field(default_factory=list)
    charts: List[ExportChart] = Field(default_factory=list)
    chartsPerPage: Literal[2] = 2


def _chunk_charts(charts: List[ExportChart], size: int = 2) -> List[List[ExportChart]]:
    return [charts[index:index + size] for index in range(0, len(charts), size)]


def _build_export_html(payload: AnalyticsExportRequest) -> str:
    escaped_title = html.escape(payload.reportTitle)
    escaped_generated_at = html.escape(payload.generatedAt)
    escaped_badges = "".join(
        f'<span class="badge">{html.escape(badge)}</span>'
        for badge in payload.summaryBadges
        if badge
    )

    page_groups = _chunk_charts(payload.charts, payload.chartsPerPage)
    pages_markup = []

    for page_index, page_charts in enumerate(page_groups):
        chart_items = []
        for chart_index, chart in enumerate(page_charts):
            chart_id = f"chart-{page_index}-{chart_index}"
            config_b64 = base64.b64encode(
                chart.model_dump_json().encode("utf-8")
            ).decode("ascii")

            metrics_markup = ""
            if chart.metrics:
                metrics_markup = (
                    '<div class="metrics">'
                    + "".join(
                        (
                            '<div class="metric">'
                            f'<p class="metric-label">{html.escape(metric.label)}</p>'
                            f'<p class="metric-value">{html.escape(metric.value)}</p>'
                            "</div>"
                        )
                        for metric in chart.metrics
                    )
                    + "</div>"
                )

            chart_items.append(
                (
                    '<article class="chart-card">'
                    f'<p class="chart-title">{html.escape(chart.title)}</p>'
                    f'<p class="chart-subtitle">{html.escape(chart.subtitle)}</p>'
                    f'<div class="plot" id="{chart_id}" data-chart="{config_b64}"></div>'
                    f"{metrics_markup}"
                    '<div class="insight">'
                    '<p class="insight-label">Trend Insight</p>'
                    f'<p class="insight-text">{html.escape(chart.insight)}</p>'
                    "</div>"
                    "</article>"
                )
            )

        pages_markup.append(
            '<section class="pdf-page">'
            '<header class="page-header">'
            '<div class="brand-row">'
            '<svg class="brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M12 2C12 2 5 10 5 14.5A7 7 0 0 0 19 14.5C19 10 12 2 12 2z"/>'
            '<path d="M8 14.5c0 1.5.8 2.8 2 3.5" opacity=".5"/>'
            '</svg>'
            '<span class="brand-name">Aquascope</span>'
            '</div>'
            f'<h1 class="report-title">{escaped_title}</h1>'
            f'<p class="report-generated">Generated: {escaped_generated_at}</p>'
            f'<div class="badge-row">{escaped_badges}</div>'
            "</header>"
            "<div class=\"charts-grid\">"
            + "".join(chart_items)
            + "</div>"
            "</section>"
        )

    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{escaped_title}</title>
    <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
    <style>
      :root {{
        --px-per-mm: 3.7795275591;
        --a4-width-px: 793.7007874016px;
        --a4-height-px: 1122.5196850394px;
        --page-margin-mm: 8;
        --page-margin-px: calc(var(--page-margin-mm) * var(--px-per-mm) * 1px);
        --safe-width: calc(var(--a4-width-px) - (var(--page-margin-px) * 2));
        --safe-height: calc(var(--a4-height-px) - (var(--page-margin-px) * 2));
        --header-height: 110px;
        --row-gap: 8px;
        --chart-slot-height: calc((var(--safe-height) - var(--header-height) - var(--row-gap)) / 2);
      }}

      @page {{
        size: A4;
        margin: calc(var(--page-margin-mm) * 1mm);
      }}

      :root {{ color-scheme: light; }}

      * {{ box-sizing: border-box; }}

      html,
      body {{
        width: var(--a4-width-px);
        min-width: var(--a4-width-px);
      }}

      body {{
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial;
        color: #0f172a;
        background: #f8fafc;
        display: block;
        overflow-x: hidden;
      }}

      .pdf-page {{
        width: var(--safe-width);
        height: var(--safe-height);
        min-height: var(--safe-height);
        max-height: var(--safe-height);
        margin: var(--page-margin-px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 8px;
        page-break-after: always;
        break-after: page;
      }}

      .pdf-page:last-child {{
        page-break-after: auto;
        break-after: auto;
      }}

      .page-header {{
        border: 1px solid #bae6fd;
        background: #ffffff;
        border-radius: 10px;
        padding: 8px 10px;
        min-height: var(--header-height);
        max-height: var(--header-height);
        overflow: hidden;
      }}

      .brand-row {{
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 2px;
      }}

      .brand-logo {{
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }}

      .brand-name {{
        font-size: 13px;
        font-weight: 700;
        color: #0284c7;
        letter-spacing: 0.06em;
      }}

      .report-title {{
        margin: 0;
        font-size: 17px;
        font-weight: 700;
      }}

      .report-generated {{
        margin: 4px 0 0;
        font-size: 11px;
        color: #475569;
      }}

      .badge-row {{
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        max-height: 34px;
        overflow: hidden;
      }}

      .badge {{
        border: 1px solid #bae6fd;
        background: #f0f9ff;
        color: #0369a1;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 10px;
      }}

      .charts-grid {{
        display: grid;
        grid-template-columns: 1fr;
        grid-template-rows: repeat(2, minmax(0, 1fr));
        gap: 8px;
        height: calc(var(--safe-height) - var(--header-height) - 8px);
        min-height: calc(var(--safe-height) - var(--header-height) - 8px);
        padding-bottom: 2px;
      }}

      .chart-card {{
        border: 1px solid #bfdbfe;
        background: #ffffff;
        border-radius: 10px;
        padding: 8px;
        height: calc(var(--chart-slot-height) - 2px);
        min-height: calc(var(--chart-slot-height) - 2px);
        max-height: calc(var(--chart-slot-height) - 2px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }}

      .chart-title {{
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #0c4a6e;
      }}

      .chart-subtitle {{
        margin: 0;
        font-size: 11px;
        color: #64748b;
        line-height: 1.2;
        max-height: 28px;
        overflow: hidden;
      }}

      .plot {{
        width: 100%;
        height: 250px;
        min-height: 250px;
        max-height: 250px;
        border: 1px solid #dbeafe;
        border-radius: 8px;
        background: #ffffff;
        overflow: hidden;
        flex: 0 0 auto;
      }}

      .chart-card.has-metrics .plot {{
        height: 210px;
        min-height: 210px;
        max-height: 210px;
      }}

      .plot .js-plotly-plot,
      .plot .plot-container,
      .plot .svg-container {{
        width: 100% !important;
        max-width: 100% !important;
        min-width: 100% !important;
      }}

      .metrics {{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        overflow: hidden;
      }}

      .metric {{
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
        padding: 4px 6px;
      }}

      .metric-label {{
        margin: 0;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #64748b;
      }}

      .metric-value {{
        margin: 4px 0 0;
        font-size: 10px;
        color: #0f172a;
        font-weight: 600;
      }}

      .insight {{
        border: 1px solid #bae6fd;
        border-radius: 8px;
        background: #f0f9ff;
        padding: 5px 7px;
        overflow: hidden;
      }}

      .insight-label {{
        margin: 0;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #0369a1;
        font-weight: 700;
      }}

      .insight-text {{
        margin: 4px 0 0;
        font-size: 10px;
        color: #0f172a;
        line-height: 1.25;
        max-height: 38px;
        overflow: hidden;
      }}
    </style>
  </head>
  <body>
    {''.join(pages_markup)}
    <script>
      async function renderCharts() {{
        const elements = Array.from(document.querySelectorAll('.plot[data-chart]'));
        for (const element of elements) {{
          const encoded = element.getAttribute('data-chart');
          if (!encoded) continue;
          const parsed = JSON.parse(atob(encoded));
          const parentCard = element.closest('.chart-card');
          if (parsed?.metrics?.length && parentCard) {{
            parentCard.classList.add('has-metrics');
          }}

          const width = Math.max(320, Math.floor(element.getBoundingClientRect().width));
          const incomingHeight = Number(parsed?.layout?.height);
          const cardHasMetrics = !!parsed?.metrics?.length;
          const maxHeight = cardHasMetrics ? 210 : 250;
          const minHeight = cardHasMetrics ? 180 : 220;
          const printHeight = Number.isFinite(incomingHeight)
            ? Math.min(Math.max(incomingHeight, minHeight), maxHeight)
            : maxHeight;

          const nextXaxis = {{ ...(parsed?.layout?.xaxis || {{}}), automargin: true }};
          const nextYaxis = {{ ...(parsed?.layout?.yaxis || {{}}), automargin: true }};

          const layout = {{
            ...parsed.layout,
            autosize: false,
            width,
            height: printHeight,
            margin: {{ l: 36, r: 14, t: 8, b: 28, ...(parsed?.layout?.margin || {{}}) }},
            xaxis: nextXaxis,
            yaxis: nextYaxis,
            paper_bgcolor: 'rgba(255,255,255,0)',
            plot_bgcolor: '#ffffff',
          }};

          await Plotly.newPlot(element, parsed.data || [], layout, {{
            responsive: true,
            displayModeBar: false,
            staticPlot: true,
          }});
        }}
        window.__PDF_CHARTS_READY__ = true;
      }}

      renderCharts().catch(() => {{
        window.__PDF_CHARTS_READY__ = true;
      }});
    </script>
  </body>
</html>
"""


@router.post("/analytics-pdf")
async def export_analytics_pdf(payload: AnalyticsExportRequest) -> Response:
    if not payload.charts:
        raise HTTPException(status_code=400, detail="At least one chart is required for export.")

    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="Playwright is not installed on the backend. Install it and run `python -m playwright install chromium`.",
        ) from exc

    html_content = _build_export_html(payload)

    with tempfile.TemporaryDirectory(prefix="analytics-export-") as temp_dir:
        html_path = Path(temp_dir) / "report.html"
        html_path.write_text(html_content, encoding="utf-8")

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page(viewport={"width": 1440, "height": 1920})
                await page.goto(html_path.as_uri(), wait_until="networkidle")
                await page.wait_for_function("() => window.__PDF_CHARTS_READY__ === true", timeout=25000)
                pdf_bytes = await page.pdf(
                    format="A4",
                    print_background=True,
                  margin={"top": "0mm", "right": "0mm", "bottom": "0mm", "left": "0mm"},
                    prefer_css_page_size=True,
                )
                await browser.close()
        except Exception as exc:
            logger.exception("Failed to generate analytics PDF")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate analytics PDF: {exc}",
            ) from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="analytics-report.pdf"'},
    )
