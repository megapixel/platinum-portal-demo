// seed: sample letter templates (internal). The client confirms the real wording (TBC).
export function seedLetterTemplates() {
  return [
    {
      id: 'lt_rec', name: 'Recommendation letter', kind: 'RECOMMENDATION', clientMayDownloadBlank: false, updatedAt: new Date().toISOString(),
      body: `<p><b>{{today}}</b></p>
<p>To whom it may concern,</p>
<p><b>Recommendation for {{client_name}} ({{case_no}})</b></p>
<p>We act for {{client_name}}, a {{nationality}} national who has lived in Singapore for {{years_in_sg}} years and holds a {{pass_type}}. {{first_name}} is employed as {{position}} at {{employer}}, with a monthly salary of SGD {{monthly_salary}}.</p>
<p>{{first_name}} holds a {{highest_qualification}} from {{institution}} and resides at {{address_sg}}.</p>
<p>In our assessment, {{first_name}} has made a steady contribution to Singapore and meets the requirements for the {{case_type}} now being prepared. We recommend the application for favourable consideration.</p>
<p>Yours faithfully,</p>
<p>{{consultant_name}}<br>Platinum Immigration Consultancy Pte. Ltd.</p>`,
    },
    {
      id: 'lt_cover', name: 'Cover letter to the authority', kind: 'COVER', clientMayDownloadBlank: false, updatedAt: new Date().toISOString(),
      body: `<p><b>{{today}}</b></p>
<p>The Controller<br>Immigration and Checkpoints Authority</p>
<p><b>Re: {{case_type}} for {{client_name}}</b></p>
<p>Our reference: {{case_no}} (attempt {{attempt}})</p>
<p>Please find enclosed the application of {{client_name}} (date of birth {{dob}}, {{nationality}}), together with the supporting documents listed in the attached index.</p>
<p>Kindly direct any correspondence on this matter to the undersigned.</p>
<p>Yours faithfully,</p>
<p>{{consultant_name}}<br>Platinum Immigration Consultancy Pte. Ltd.</p>`,
    },
  ];
}
