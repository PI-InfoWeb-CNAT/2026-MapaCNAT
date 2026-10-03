from django import forms

class FeedbackForm(forms.Form):
    RATING_CHOICES = [
        ('5', '5 estrelas'),
        ('4', '4 estrelas'),
        ('3', '3 estrelas'),
        ('2', '2 estrelas'),
        ('1', '1 estrela'),
    ]

    rating = forms.ChoiceField(
        choices=RATING_CHOICES,
        widget=forms.RadioSelect(attrs={'class': 'rating-input'}),
        error_messages={'required': 'Por favor, selecione uma nota.'}
    )
    
    comment = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={
            'class': 'feedback__text',
            'placeholder': 'Descreva como podemos melhorar...'
        })
    )